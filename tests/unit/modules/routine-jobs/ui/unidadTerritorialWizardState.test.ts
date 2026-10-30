import { describe, expect, it } from "vitest";
import { parseUnidadTerritorialStartRequest } from "@/modules/routine-jobs/api/unidadTerritorialRequestParsing";
import { plannedUnitStepLabels } from "@/modules/routine-jobs/jobs/unidad-territorial/domain/plannedSteps";
import { RunPhase } from "@/modules/routine-jobs/ui/jobRunStore";
import {
  activeSlotsOf,
  blockingReason,
  initialUnidadWizardStateFor,
  toUnidadStartRequest,
  unidadWizardReducer,
  UnitSlot,
  type UnidadTerritorialWizardState,
} from "@/modules/routine-jobs/ui/unidadTerritorialWizardState";

const MESSAGE_TABLES_DISTINCT = "Las tablas elegidas deben ser distintas: no repita el mismo esquema y nombre.";
const TARGET_TABLE = "territorial_unit";
const ADDRESS_MASTER = { schema: "carto", table: "addresses_master" };

const SEED = {
  connection: { host: "db.local", port: "5432", db_name: "gis", user: "gis_user", password: "Unidad-pw!7" },
};

const initialState = (): UnidadTerritorialWizardState =>
  initialUnidadWizardStateFor({ phase: RunPhase.IDLE }, SEED);

const withLink = (state: UnidadTerritorialWizardState, linkAddressMaster: boolean): UnidadTerritorialWizardState =>
  unidadWizardReducer(state, { type: "optionsChanged", patch: { linkAddressMaster } });

const withActiveTablesValid = (state: UnidadTerritorialWizardState): UnidadTerritorialWizardState =>
  activeSlotsOf(state).reduce(
    (next, key) => unidadWizardReducer(next, { type: "slotTableChosen", key, table: next.slots[key].table, valid: true }),
    state
  );

describe("unidadTerritorialWizardState", () => {
  describe("linkAddressMaster option (UT-11, UT-15, UT-17)", () => {
    it("should prefill, clear and re-prefill the address master table and revalidate the target on each link change", () => {
      const initial = initialState();
      expect(initial.options.linkAddressMaster).toBe(true);
      expect(initial.slots[UnitSlot.ADDRESS_MASTER]).toEqual({ ...ADDRESS_MASTER, valid: false });

      const targetValid = unidadWizardReducer(initial, {
        type: "slotTableChosen",
        key: UnitSlot.TARGET,
        table: TARGET_TABLE,
        valid: true,
      });
      const typed = unidadWizardReducer(targetValid, { type: "confirmationChanged", patch: { typedTable: TARGET_TABLE } });
      const unchanged = withLink(typed, true);
      expect(unchanged.slots[UnitSlot.TARGET].valid).toBe(true);

      const off = withLink(unchanged, false);
      expect(off.options.linkAddressMaster).toBe(false);
      expect(off.slots[UnitSlot.ADDRESS_MASTER]).toEqual({ schema: "carto", table: "", valid: false });
      expect(off.slots[UnitSlot.TARGET]).toEqual({ schema: "carto", table: TARGET_TABLE, valid: false });
      expect(off.confirmation.typedTable).toBe(TARGET_TABLE);

      const chosenWhileOff = unidadWizardReducer(off, {
        type: "slotTableChosen",
        key: UnitSlot.ADDRESS_MASTER,
        table: "direcciones_propias",
        valid: true,
      });
      const onKeepingTable = withLink(chosenWhileOff, true);
      expect(onKeepingTable.slots[UnitSlot.ADDRESS_MASTER]).toEqual({ schema: "carto", table: "direcciones_propias", valid: false });

      const on = withLink(off, true);
      expect(on.slots[UnitSlot.ADDRESS_MASTER]).toEqual({ ...ADDRESS_MASTER, valid: false });
      expect(on.slots[UnitSlot.TARGET]).toEqual({ schema: "carto", table: TARGET_TABLE, valid: false });
      expect(on.confirmation.typedTable).toBe(TARGET_TABLE);
    });

    it("should count the address master table in the distinct-name rule only while the link is on", () => {
      const linked = withActiveTablesValid(initialState());
      expect(blockingReason(linked)).toBeNull();

      const repeatedName = unidadWizardReducer(linked, {
        type: "slotTableChosen",
        key: UnitSlot.ADDRESS_MASTER,
        table: TARGET_TABLE,
        valid: true,
      });
      expect(blockingReason(repeatedName)).toBe(MESSAGE_TABLES_DISTINCT);

      const unlinked = withActiveTablesValid(withLink(initialState(), false));
      const sameNameAsHiddenMaster = unidadWizardReducer(unlinked, {
        type: "slotTableChosen",
        key: UnitSlot.TARGET,
        table: ADDRESS_MASTER.table,
        valid: true,
      });
      expect(blockingReason(sameNameAsHiddenMaster)).toBeNull();
    });
  });

  describe("start request contract", () => {
    it("should send the address master table at the top level and linkAddressMaster in options, and parse them back", () => {
      const linked = withActiveTablesValid(initialState());
      const unlinked = withActiveTablesValid(withLink(initialState(), false));
      const linkedBody = JSON.parse(JSON.stringify(toUnidadStartRequest(linked, { dryRun: false })));
      const unlinkedBody = JSON.parse(JSON.stringify(toUnidadStartRequest(unlinked, { dryRun: false })));

      expect(linkedBody).toMatchObject({ options: { linkAddressMaster: true }, addressMasterTable: ADDRESS_MASTER });
      const linkedParams = parseUnidadTerritorialStartRequest(linkedBody);
      expect(linkedParams.options.linkAddressMaster).toBe(true);
      expect(linkedParams.addressMasterTable).toEqual(ADDRESS_MASTER);

      expect(unlinkedBody.options.linkAddressMaster).toBe(false);
      expect(unlinkedBody).not.toHaveProperty("addressMasterTable");
      const unlinkedParams = parseUnidadTerritorialStartRequest(unlinkedBody);
      expect(unlinkedParams.options.linkAddressMaster).toBe(false);
      expect(unlinkedParams).not.toHaveProperty("addressMasterTable");
    });
  });

  describe("planned steps", () => {
    it("should add the four address master steps between apply and analyze only when the link is on", () => {
      const linked = plannedUnitStepLabels({ dryRun: false, linkAddressMaster: true });
      const unlinked = plannedUnitStepLabels({ dryRun: false, linkAddressMaster: false });
      const addressMasterSteps = [
        "Ajustar secuencia de direcciones maestras",
        "Clasificar unidades sin dirección maestra",
        "Crear y enlazar direcciones maestras de unidades",
        "Verificar unidades pendientes",
      ];

      expect(linked).toHaveLength(unlinked.length + 4);
      expect(linked.slice(linked.indexOf("Aplicar cambios de unidades territoriales") + 1, linked.indexOf("Analizar tabla de destino"))).toEqual(
        addressMasterSteps
      );
      expect(unlinked.filter((label) => addressMasterSteps.includes(label))).toEqual([]);
    });
  });
});
