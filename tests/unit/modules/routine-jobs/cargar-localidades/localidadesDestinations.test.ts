import { describe, it, expect } from "vitest";
import {
  blockingReason,
  canContinue,
  canRunNow,
  includedTargetsOf,
  initialWizardStateFor,
  localidadesWizardReducer,
  runBlockedReason,
  toStartRequest,
  type LocalidadesDestination,
  type LocalidadesWizardAction,
  type LocalidadesWizardState,
} from "@/modules/routine-jobs/ui/cargarLocalidadesWizardState";
import { RunPhase } from "@/modules/routine-jobs/ui/jobRunStore";
import type { CargarLocalidadesRunSnapshot } from "@/modules/routine-jobs/ui/cargarLocalidadesRunStore";

const PASSWORD = "s3cret-pw";
const BDJ_CARTO: LocalidadesDestination = "bdjCarto";
const CARTO: LocalidadesDestination = "carto";
const STAGING_SCHEMA = "stg";
const CARTO_SCHEMA = "carto";
const PADRON_TABLE = "padron_stg";
const LOCALITY_TABLE = "localidades_stg";
const PROVINCE_TABLE = "province";
const BDJ_TABLE = "cadastral_locality";
const CARTO_TABLE = "cadastral_locality_copia";
const NO_DESTINATION_MESSAGE = "Incluya al menos un destino";

const IDLE_SNAPSHOT: CargarLocalidadesRunSnapshot = { phase: RunPhase.IDLE };

const connection = { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: PASSWORD };

const dispatch = (state: LocalidadesWizardState, action: LocalidadesWizardAction): LocalidadesWizardState =>
  localidadesWizardReducer(state, action);

const dispatchAll = (state: LocalidadesWizardState, actions: LocalidadesWizardAction[]): LocalidadesWizardState =>
  actions.reduce(dispatch, state);

const freshState = (): LocalidadesWizardState => initialWizardStateFor(IDLE_SNAPSHOT, { connection });

const sourceTablesActions = (): LocalidadesWizardAction[] => [
  { type: "stagingSchemaChanged", schema: STAGING_SCHEMA },
  { type: "tableChosen", key: "padron", table: PADRON_TABLE, valid: true },
  { type: "tableChosen", key: "locality", table: LOCALITY_TABLE, valid: true },
  { type: "provinceSchemaChanged", schema: CARTO_SCHEMA },
  { type: "tableChosen", key: "province", table: PROVINCE_TABLE, valid: true },
];

const targetActions = (destination: LocalidadesDestination, table: string, valid = true): LocalidadesWizardAction[] => [
  { type: "targetSchemaChanged", destination, schema: CARTO_SCHEMA },
  { type: "targetChosen", destination, table, valid },
];

const readyWithBdj = (): LocalidadesWizardState =>
  dispatchAll(freshState(), [...sourceTablesActions(), ...targetActions(BDJ_CARTO, BDJ_TABLE)]);

const readyWithBoth = (): LocalidadesWizardState =>
  dispatchAll(readyWithBdj(), [
    { type: "targetIncludedChanged", destination: CARTO, included: true },
    ...targetActions(CARTO, CARTO_TABLE),
  ]);

describe("cargar-localidades destinations (stage 2)", () => {
  describe("one included destination", () => {
    it("should include only the bdjCarto destination by default", () => {
      const destinations = includedTargetsOf(freshState()).map((target) => target.destination);

      expect(destinations).toEqual([BDJ_CARTO]);
    });

    it("should send exactly one target in the start request when one destination is included", () => {
      const request = toStartRequest(readyWithBdj(), { dryRun: true });

      expect(request.targets).toEqual([{ schema: CARTO_SCHEMA, table: BDJ_TABLE }]);
    });

    it("should have no blocking reason on the tables step when the one included destination is complete", () => {
      expect(blockingReason(readyWithBdj())).toBeNull();
    });
  });

  describe("two included destinations", () => {
    it("should include both destinations in the order bdjCarto then carto", () => {
      const destinations = includedTargetsOf(readyWithBoth()).map((target) => target.destination);

      expect(destinations).toEqual([BDJ_CARTO, CARTO]);
    });

    it("should send both targets in the start request when both destinations are included", () => {
      const request = toStartRequest(readyWithBoth(), { dryRun: true });

      expect(request.targets).toEqual([
        { schema: CARTO_SCHEMA, table: BDJ_TABLE },
        { schema: CARTO_SCHEMA, table: CARTO_TABLE },
      ]);
    });
  });

  describe("excluded destination", () => {
    it("should keep an excluded destination out of the start request targets even when its table is chosen", () => {
      const state = dispatchAll(readyWithBdj(), targetActions(CARTO, CARTO_TABLE));

      const request = toStartRequest(state, { dryRun: true });

      expect(state.targets[CARTO].included).toBe(false);
      expect(request.targets.map((target) => target.table)).not.toContain(CARTO_TABLE);
    });

    it("should ignore an excluded destination that repeats a fixed table name in the distinctness check", () => {
      const state = dispatchAll(readyWithBdj(), targetActions(CARTO, PROVINCE_TABLE));

      expect(blockingReason(state)).toBeNull();
    });

    it("should ignore an excluded destination that is invalid in the validity check", () => {
      const state = dispatchAll(readyWithBdj(), targetActions(CARTO, CARTO_TABLE, false));

      expect(blockingReason(state)).toBeNull();
    });

    it("should block on the same repeated name once that destination is included", () => {
      const state = dispatchAll(readyWithBdj(), [
        ...targetActions(CARTO, PROVINCE_TABLE),
        { type: "targetIncludedChanged", destination: CARTO, included: true },
      ]);

      expect(blockingReason(state)).toMatch(/distintas/);
    });

    it("should block on the invalid table once that destination is included", () => {
      const state = dispatchAll(readyWithBdj(), [
        ...targetActions(CARTO, CARTO_TABLE, false),
        { type: "targetIncludedChanged", destination: CARTO, included: true },
      ]);

      expect(blockingReason(state)).toMatch(/columnas faltantes/);
    });
  });

  describe("zero included destinations", () => {
    const withoutAnyDestination = (): LocalidadesWizardState =>
      dispatch(readyWithBdj(), { type: "targetIncludedChanged", destination: BDJ_CARTO, included: false });

    it("should block with the include-at-least-one-destination reason when no destination is included", () => {
      expect(blockingReason(withoutAnyDestination())).toContain(NO_DESTINATION_MESSAGE);
    });

    it("should refuse to continue and refuse to run when no destination is included", () => {
      const state = withoutAnyDestination();

      expect(canContinue(state)).toBe(false);
      expect(runBlockedReason(state)).toContain(NO_DESTINATION_MESSAGE);
      expect(canRunNow(state, { dryRun: true })).toBe(false);
    });

    it("should send no targets when no destination is included", () => {
      expect(toStartRequest(withoutAnyDestination(), { dryRun: true }).targets).toEqual([]);
    });
  });

  describe("typed confirmation per destination", () => {
    const reviewWithBoth = (): LocalidadesWizardState => dispatch(readyWithBoth(), { type: "goTo", step: "review" });

    it("should allow a dry run with only the password typed, whatever the destinations", () => {
      const state = dispatch(reviewWithBoth(), { type: "confirmationChanged", patch: { password: PASSWORD } });

      expect(canRunNow(state, { dryRun: true })).toBe(true);
    });

    it("should refuse a real run until every included destination has its table typed", () => {
      const state = dispatch(reviewWithBoth(), {
        type: "confirmationChanged",
        patch: { password: PASSWORD, typedTables: { bdjCarto: BDJ_TABLE, carto: "" } },
      });

      expect(canRunNow(state, { dryRun: false })).toBe(false);
    });

    it("should refuse a real run when a typed table belongs to another destination", () => {
      const state = dispatch(reviewWithBoth(), {
        type: "confirmationChanged",
        patch: { password: PASSWORD, typedTables: { bdjCarto: CARTO_TABLE, carto: BDJ_TABLE } },
      });

      expect(canRunNow(state, { dryRun: false })).toBe(false);
    });

    it("should allow a real run once each included destination has its own table typed", () => {
      const state = dispatch(reviewWithBoth(), {
        type: "confirmationChanged",
        patch: { password: PASSWORD, typedTables: { bdjCarto: BDJ_TABLE, carto: CARTO_TABLE } },
      });

      expect(canRunNow(state, { dryRun: false })).toBe(true);
    });

    it("should not require the table of an excluded destination for a real run", () => {
      const state = dispatch(readyWithBdj(), { type: "goTo", step: "review" });
      const typed = dispatch(state, {
        type: "confirmationChanged",
        patch: { password: PASSWORD, typedTables: { bdjCarto: BDJ_TABLE, carto: "" } },
      });

      expect(canRunNow(typed, { dryRun: false })).toBe(true);
    });

    it("should clear the typed table of a destination whose table is changed", () => {
      const typed = dispatch(reviewWithBoth(), {
        type: "confirmationChanged",
        patch: { password: PASSWORD, typedTables: { bdjCarto: BDJ_TABLE, carto: CARTO_TABLE } },
      });

      const changed = dispatch(typed, { type: "targetChosen", destination: CARTO, table: "otra_tabla", valid: true });

      expect(changed.confirmation.typedTables.carto).toBe("");
      expect(changed.confirmation.typedTables.bdjCarto).toBe(BDJ_TABLE);
    });

    it("should clear the typed table of a destination when it is excluded", () => {
      const typed = dispatch(reviewWithBoth(), {
        type: "confirmationChanged",
        patch: { typedTables: { bdjCarto: BDJ_TABLE, carto: CARTO_TABLE } },
      });

      const excluded = dispatch(typed, { type: "targetIncludedChanged", destination: CARTO, included: false });

      expect(excluded.confirmation.typedTables.carto).toBe("");
    });
  });
});
