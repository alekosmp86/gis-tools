import { describe, expect, it } from "vitest";
import {
  ActualizarTableKey,
  blockingReason,
  canContinue,
  canRunNow,
  initialWizardState,
  isRealRunConfirmed,
  toStartRequest,
  wizardReducer,
  WizardStep,
  type ActualizarWizardState,
} from "@/modules/routine-jobs/ui/actualizarPadronWizardState";

const PASSWORD = "s3cret-pw";
const TARGET_TABLE = "padron_tmp_actualizacion";
const MESSAGE_TABLES_MISSING = "Elija las tablas obligatorias: origen, destino, provincias y localidades.";
const MESSAGE_TABLES_DISTINCT = "Las tablas elegidas deben ser distintas dentro de su esquema.";
const MESSAGE_CARTO_SCHEMA = "Indique el esquema de carto: destino, provincias, localidades y tipos.";

const tablesStep = (overrides: Partial<ActualizarWizardState> = {}): ActualizarWizardState => ({
  ...initialWizardState(),
  step: WizardStep.TABLES,
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "carto", password: PASSWORD },
  stagingSchema: "bdj_carto",
  cartoSchema: "carto",
  tables: {
    [ActualizarTableKey.STAGING]: "catastro_paispadron_stg",
    [ActualizarTableKey.TARGET]: TARGET_TABLE,
    [ActualizarTableKey.PROVINCE]: "province",
    [ActualizarTableKey.LOCALITY]: "cadastral_locality",
    [ActualizarTableKey.TYPE]: "",
    [ActualizarTableKey.ADDRESS_MASTER]: "",
  },
  tableValidity: {
    [ActualizarTableKey.STAGING]: true,
    [ActualizarTableKey.TARGET]: true,
    [ActualizarTableKey.PROVINCE]: true,
    [ActualizarTableKey.LOCALITY]: true,
    [ActualizarTableKey.TYPE]: false,
    [ActualizarTableKey.ADDRESS_MASTER]: false,
  },
  ...overrides,
});

const reviewStep = (overrides: Partial<ActualizarWizardState> = {}): ActualizarWizardState => ({
  ...tablesStep(overrides),
  step: WizardStep.REVIEW,
});

describe("actualizarPadronWizardState", () => {
  describe("tables step: two schemas and the target table", () => {
    it("should let the tables step continue when both schemas and the four required tables are set and valid", () => {
      expect(canContinue(tablesStep())).toBe(true);
      expect(blockingReason(tablesStep())).toBeNull();
    });

    it("should block the tables step while the carto schema is blank, naming the carto schema", () => {
      const state = tablesStep({ cartoSchema: "  " });

      expect(canContinue(state)).toBe(false);
      expect(blockingReason(state)).toBe(MESSAGE_CARTO_SCHEMA);
    });

    it("should block the tables step while the target table is blank", () => {
      const state = tablesStep({ tables: { ...tablesStep().tables, [ActualizarTableKey.TARGET]: "  " } });

      expect(canContinue(state)).toBe(false);
      expect(blockingReason(state)).toBe(MESSAGE_TABLES_MISSING);
    });

    it("should block the tables step while the chosen target table is not valid", () => {
      const state = tablesStep({
        tableValidity: { ...tablesStep().tableValidity, [ActualizarTableKey.TARGET]: false },
      });

      expect(canContinue(state)).toBe(false);
    });

    it("should block a target table that repeats the province table in the same carto schema", () => {
      const state = tablesStep({
        tables: { ...tablesStep().tables, [ActualizarTableKey.TARGET]: "province" },
      });

      expect(blockingReason(state)).toBe(MESSAGE_TABLES_DISTINCT);
    });

    it("should let a staging table share the name of the target table when it lives in another schema", () => {
      const state = tablesStep({
        stagingSchema: "otro_esquema",
        tables: { ...tablesStep().tables, [ActualizarTableKey.STAGING]: TARGET_TABLE },
      });

      expect(canContinue(state)).toBe(true);
    });
  });

  describe("typed confirmation of a real run", () => {
    it("should allow a dry run once the password is typed on the review, without the table name", () => {
      const state = reviewStep({ confirmation: { password: PASSWORD, typedTable: "" } });

      expect(canRunNow(state, { dryRun: true })).toBe(true);
    });

    it("should refuse a dry run without the password typed on the review", () => {
      const state = reviewStep({ confirmation: { password: "", typedTable: "" } });

      expect(canRunNow(state, { dryRun: true })).toBe(false);
    });

    it("should allow a real run only when the target table name and the password are both typed", () => {
      const state = reviewStep({ confirmation: { password: PASSWORD, typedTable: TARGET_TABLE } });

      expect(isRealRunConfirmed(state)).toBe(true);
      expect(canRunNow(state, { dryRun: false })).toBe(true);
    });

    it("should refuse a real run when the typed table name differs in case from the target table", () => {
      const state = reviewStep({ confirmation: { password: PASSWORD, typedTable: TARGET_TABLE.toUpperCase() } });

      expect(canRunNow(state, { dryRun: false })).toBe(false);
    });

    it("should refuse a real run without the typed table name even when the password is typed", () => {
      const state = reviewStep({ confirmation: { password: PASSWORD, typedTable: "" } });

      expect(canRunNow(state, { dryRun: false })).toBe(false);
    });

    it("should clear the typed table name when the target table changes", () => {
      const state = reviewStep({ confirmation: { password: PASSWORD, typedTable: TARGET_TABLE } });

      const next = wizardReducer(state, { type: "tableChosen", key: ActualizarTableKey.TARGET, table: "padron_otro", valid: true });

      expect(next.confirmation.typedTable).toBe("");
    });
  });

  describe("start request", () => {
    it("should send the two schemas, the five tables and no type table when none is chosen", () => {
      const request = toStartRequest(tablesStep({ options: { localityType: "LOCALIDAD CATASTRAL", tolerance: "1.0", updateGeometries: true, linkAddressMaster: false } }), {
        dryRun: true,
      });

      expect(request).toMatchObject({
        stagingSchema: "bdj_carto",
        stagingTable: "catastro_paispadron_stg",
        cartoSchema: "carto",
        targetTable: TARGET_TABLE,
        provinceTable: "province",
        localityTable: "cadastral_locality",
        dryRun: true,
        confirm: false,
      });
      expect(request).not.toHaveProperty("typeTable");
    });
  });

  describe("address master link option (AP-51, AP-53)", () => {
    const ADDRESS_MASTER_SUGGESTION = "addresses_master";

    it("should default the address master link to off when the wizard opens", () => {
      expect(initialWizardState().options.linkAddressMaster).toBe(false);
    });

    it("should suggest addresses_master as the address master table when the link is turned on", () => {
      const next = wizardReducer(tablesStep(), { type: "optionsChanged", patch: { linkAddressMaster: true } });

      expect(next.options.linkAddressMaster).toBe(true);
      expect(next.tables[ActualizarTableKey.ADDRESS_MASTER]).toBe(ADDRESS_MASTER_SUGGESTION);
    });

    it("should clear the address master table when the link is turned off", () => {
      const linked = wizardReducer(tablesStep(), { type: "optionsChanged", patch: { linkAddressMaster: true } });

      const next = wizardReducer(linked, { type: "optionsChanged", patch: { linkAddressMaster: false } });

      expect(next.options.linkAddressMaster).toBe(false);
      expect(next.tables[ActualizarTableKey.ADDRESS_MASTER]).toBe("");
    });

    it("should send linkAddressMaster and the address master table when the link is on", () => {
      const linked = wizardReducer(tablesStep(), { type: "optionsChanged", patch: { linkAddressMaster: true } });

      const request = toStartRequest(linked, { dryRun: true });

      expect(request.options.linkAddressMaster).toBe(true);
      expect(request).toMatchObject({ addressMasterTable: ADDRESS_MASTER_SUGGESTION });
    });

    it("should send linkAddressMaster false and no address master table when the link is off", () => {
      const request = toStartRequest(tablesStep(), { dryRun: true });

      expect(request.options.linkAddressMaster).toBe(false);
      expect(request).not.toHaveProperty("addressMasterTable");
    });
  });
});
