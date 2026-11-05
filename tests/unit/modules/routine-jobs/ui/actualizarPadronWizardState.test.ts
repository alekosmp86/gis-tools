import { describe, expect, it } from "vitest";
import type { ActualizarPadronResult, PairChoice } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import {
  ActualizarTableKey,
  blockingReason,
  canContinue,
  canRunNow,
  completedAnalysisPlanIdOf,
  completedDryRunChoicesOf,
  initialWizardState,
  initialWizardStateFor,
  isRealRunConfirmed,
  persistBlockedReason,
  simulationBlockingReason,
  toPersistRequest,
  toStartRequest,
  wizardReducer,
  WizardStep,
  type ActualizarWizardState,
} from "@/modules/routine-jobs/ui/actualizarPadronWizardState";
import type { ActualizarPadronRunSnapshot } from "@/modules/routine-jobs/ui/actualizarPadronRunStore";
import { RunPhase } from "@/modules/routine-jobs/ui/jobRunStore";
import { actualizarPadronResultOf } from "./reportCsv/reportCsvFixtures";

const PASSWORD = "s3cret-pw";
const TARGET_TABLE = "padron_tmp_actualizacion";
const PLAN_ID = "3ab12cd9e8f7d6c5b4a39281706f5e4d";
const MESSAGE_TABLES_MISSING = "Elija las tablas obligatorias: origen, destino, provincias y localidades.";
const MESSAGE_TABLES_DISTINCT = "Las tablas elegidas deben ser distintas dentro de su esquema.";
const MESSAGE_CARTO_SCHEMA = "Indique el esquema de carto: destino, provincias, localidades y tipos.";
const MESSAGE_TOLERANCE = "La tolerancia debe ser un número mayor o igual que 0.";
const MESSAGE_PLAN_MISSING = "El análisis no dejó un plan para guardar: vuelva a analizar.";
const MESSAGE_CONFIRMATION_TABLE_MISSING = "Escriba de nuevo el nombre de la tabla de destino para persistir.";
const MESSAGE_CONFIRMATION_PASSWORD_MISSING = "Escriba de nuevo la contraseña para persistir.";
const MESSAGE_CONFIRMATION_BOTH_MISSING = "Escriba de nuevo la contraseña y el nombre de la tabla de destino para persistir.";
const MESSAGE_SIMULATION_STALE = "Analice de nuevo con la selección de pares actual antes de persistir.";

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
      const request = toStartRequest(tablesStep({ options: { localityType: "LOCALIDAD CATASTRAL", tolerance: "1.0", geometryAreaThresholdPercent: "5", updateGeometries: true, linkAddressMaster: false, repairSequences: false } }), {
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

    it("should send the geometry area threshold as the typed percent divided by 100 (AP-92)", () => {
      const options = { localityType: "LOCALIDAD CATASTRAL", tolerance: "1.0", geometryAreaThresholdPercent: "12.5", updateGeometries: true, linkAddressMaster: false, repairSequences: false };

      const request = toStartRequest(tablesStep({ options }), { dryRun: true });

      expect(request.options.geometryAreaThreshold).toBe(0.125);
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

      const next = wizardReducer(linked, { type: "optionsChanged", patch: { linkAddressMaster: false, repairSequences: false } });

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

  describe("pair choices", () => {
    const PAIR_CHOICE: PairChoice = { typePadron: "RURAL", provinceId: 6, localityId: 120, number: "100", oldId: 7 };
    const NOT_PAIRED_CHOICE: PairChoice = { typePadron: "RURAL", provinceId: 6, localityId: 120, number: "200", oldId: null };
    const OPTIONS = { localityType: "LOCALIDAD CATASTRAL", tolerance: "1.0", geometryAreaThresholdPercent: "5", updateGeometries: true, linkAddressMaster: false, repairSequences: false };

    it("should store a chosen pair candidate in the pair choices", () => {
      const next = wizardReducer(tablesStep(), { type: "pairChoiceChosen", choice: PAIR_CHOICE });

      expect(next.pairChoices).toEqual([PAIR_CHOICE]);
    });

    it("should clear the pair choices when the target table changes", () => {
      const state = tablesStep({ pairChoices: [PAIR_CHOICE] });

      const next = wizardReducer(state, { type: "tableChosen", key: ActualizarTableKey.TARGET, table: "padron_otro", valid: true });

      expect(next.pairChoices).toEqual([]);
    });

    it("should clear the pair choices when the province table changes", () => {
      const state = tablesStep({ pairChoices: [PAIR_CHOICE] });

      const next = wizardReducer(state, { type: "tableChosen", key: ActualizarTableKey.PROVINCE, table: "provincia_nueva", valid: true });

      expect(next.pairChoices).toEqual([]);
    });

    it("should keep the pair choices when a table is chosen with the same name it already had", () => {
      const state = tablesStep({ pairChoices: [PAIR_CHOICE] });

      const next = wizardReducer(state, { type: "tableChosen", key: ActualizarTableKey.TARGET, table: TARGET_TABLE, valid: true });

      expect(next.pairChoices).toEqual([PAIR_CHOICE]);
    });

    it("should clear the pair choices when the staging schema changes", () => {
      const state = tablesStep({ pairChoices: [PAIR_CHOICE] });

      const next = wizardReducer(state, { type: "schemaChanged", field: "stagingSchema", value: "otro_esquema" });

      expect(next.pairChoices).toEqual([]);
    });

    it("should clear the pair choices when the carto schema changes", () => {
      const state = tablesStep({ pairChoices: [PAIR_CHOICE] });

      const next = wizardReducer(state, { type: "schemaChanged", field: "cartoSchema", value: "otro_carto" });

      expect(next.pairChoices).toEqual([]);
    });

    it("should clear the pair choices when an option changes", () => {
      const state = tablesStep({ pairChoices: [PAIR_CHOICE], options: OPTIONS });

      const next = wizardReducer(state, { type: "optionsChanged", patch: { tolerance: "2.5" } });

      expect(next.pairChoices).toEqual([]);
    });

    it("should keep the pair choices when an option is set to the value it already has", () => {
      const state = tablesStep({ pairChoices: [PAIR_CHOICE], options: OPTIONS });

      const next = wizardReducer(state, { type: "optionsChanged", patch: { tolerance: OPTIONS.tolerance } });

      expect(next.pairChoices).toEqual([PAIR_CHOICE]);
    });

    it("should omit pairChoices from the start request when no choice is made", () => {
      const request = toStartRequest(tablesStep({ options: OPTIONS }), { dryRun: true });

      expect(request.options).not.toHaveProperty("pairChoices");
    });

    it("should send the pair choices in the start request options when choices are made", () => {
      const request = toStartRequest(tablesStep({ options: OPTIONS, pairChoices: [PAIR_CHOICE] }), { dryRun: true });

      expect(request.options.pairChoices).toEqual([PAIR_CHOICE]);
    });

    it("should send a null old id choice in the start request so that the new padron is not paired", () => {
      const request = toStartRequest(tablesStep({ options: OPTIONS, pairChoices: [NOT_PAIRED_CHOICE] }), { dryRun: true });

      expect(request.options.pairChoices).toEqual([NOT_PAIRED_CHOICE]);
    });

    it("should keep only the password when a dry run starts and drop the typed table name", () => {
      const state = reviewStep({ confirmation: { password: PASSWORD, typedTable: TARGET_TABLE } });

      const next = wizardReducer(state, { type: "runStarted", dryRun: true });

      expect(next.step).toBe(WizardStep.RESULT);
      expect(next.confirmation).toEqual({ password: PASSWORD, typedTable: "" });
    });

    it("should clear the typed confirmation when a real run starts", () => {
      const state = reviewStep({ confirmation: { password: PASSWORD, typedTable: TARGET_TABLE } });

      const next = wizardReducer(state, { type: "runStarted", dryRun: false });

      expect(next.step).toBe(WizardStep.RESULT);
      expect(next.confirmation).toEqual({ password: "", typedTable: "" });
    });
  });

  describe("typed table name lifetime: only the password survives a change", () => {
    const TYPED = { password: PASSWORD, typedTable: TARGET_TABLE };

    it("should keep only the password when an option changes", () => {
      const state = reviewStep({ confirmation: TYPED });

      const next = wizardReducer(state, { type: "optionsChanged", patch: { tolerance: "2.5" } });

      expect(next.confirmation).toEqual({ password: PASSWORD, typedTable: "" });
    });

    it("should keep only the password when a table is chosen under a new name", () => {
      const state = reviewStep({ confirmation: TYPED });

      const next = wizardReducer(state, { type: "tableChosen", key: ActualizarTableKey.PROVINCE, table: "provincia_nueva", valid: true });

      expect(next.confirmation).toEqual({ password: PASSWORD, typedTable: "" });
    });

    it("should keep only the password when the carto schema changes", () => {
      const state = reviewStep({ confirmation: TYPED });

      const next = wizardReducer(state, { type: "schemaChanged", field: "cartoSchema", value: "otro_carto" });

      expect(next.confirmation).toEqual({ password: PASSWORD, typedTable: "" });
    });

    it("should keep only the password when the review goes back to the options step", () => {
      const state = reviewStep({ confirmation: TYPED });

      const next = wizardReducer(state, { type: "back" });

      expect(next.step).toBe(WizardStep.OPTIONS);
      expect(next.confirmation).toEqual({ password: PASSWORD, typedTable: "" });
    });

    it("should keep only the password when the review jumps back to the tables step", () => {
      const state = reviewStep({ confirmation: TYPED });

      const next = wizardReducer(state, { type: "goTo", step: WizardStep.TABLES });

      expect(next.step).toBe(WizardStep.TABLES);
      expect(next.confirmation).toEqual({ password: PASSWORD, typedTable: "" });
    });

    it("should keep only the password when the result jumps back to the tables step", () => {
      const state = { ...reviewStep({ confirmation: TYPED }), step: WizardStep.RESULT };

      const next = wizardReducer(state, { type: "goTo", step: WizardStep.TABLES });

      expect(next.step).toBe(WizardStep.TABLES);
      expect(next.confirmation).toEqual({ password: PASSWORD, typedTable: "" });
    });

    it("should keep the typed table name when the result goes back to the review, which is still on screen", () => {
      const state = { ...reviewStep({ confirmation: TYPED }), step: WizardStep.RESULT };

      const next = wizardReducer(state, { type: "back" });

      expect(next.step).toBe(WizardStep.REVIEW);
      expect(next.confirmation).toEqual(TYPED);
    });
  });

  describe("pair choice removal and simulated choices", () => {
    const CHOICE_ONE: PairChoice = { typePadron: "RURAL", provinceId: 6, localityId: 120, number: "100", oldId: 7 };
    const CHOICE_TWO: PairChoice = { typePadron: "RURAL", provinceId: 6, localityId: 120, number: "200", oldId: 8 };
    const OPTIONS = { localityType: "LOCALIDAD CATASTRAL", tolerance: "1.0", geometryAreaThresholdPercent: "5", updateGeometries: true, linkAddressMaster: false, repairSequences: false };

    const dryRunSnapshotOf = (phase: RunPhase, pairChoices: PairChoice[], dryRun = true): ActualizarPadronRunSnapshot => ({
      phase,
      plan: { dryRun, destinationTable: TARGET_TABLE, linkAddressMaster: false, repairSequences: false, pairChoices },
    });

    it("should start with no simulated choices when the wizard opens", () => {
      expect(initialWizardState().simulatedChoices).toBeNull();
    });

    it("should record the choices of a completed dry run as the simulated choices", () => {
      const state = reviewStep({ pairChoices: [CHOICE_ONE] });

      const next = wizardReducer(state, { type: "dryRunCompleted", choices: [CHOICE_ONE] });

      expect(next.simulatedChoices).toEqual([CHOICE_ONE]);
    });

    it("should block a real run when pair choices exist and no dry run completed (simulated choices null)", () => {
      const state = reviewStep({ options: OPTIONS, pairChoices: [CHOICE_ONE], simulatedChoices: null, confirmation: { password: PASSWORD, typedTable: TARGET_TABLE } });

      expect(simulationBlockingReason(state)).toBe(MESSAGE_SIMULATION_STALE);
      expect(canRunNow(state, { dryRun: false })).toBe(false);
    });

    it("should block a real run when the simulated choices differ in old id", () => {
      const state = reviewStep({
        options: OPTIONS,
        pairChoices: [CHOICE_ONE],
        simulatedChoices: [{ ...CHOICE_ONE, oldId: 99 }],
        confirmation: { password: PASSWORD, typedTable: TARGET_TABLE },
      });

      expect(simulationBlockingReason(state)).toBe(MESSAGE_SIMULATION_STALE);
      expect(canRunNow(state, { dryRun: false })).toBe(false);
    });

    it("should block a real run when every pair choice was cleared after an analysis that had choices", () => {
      const state = reviewStep({
        options: OPTIONS,
        pairChoices: [],
        simulatedChoices: [CHOICE_ONE],
        confirmation: { password: PASSWORD, typedTable: TARGET_TABLE },
      });

      expect(simulationBlockingReason(state)).toBe(MESSAGE_SIMULATION_STALE);
      expect(canRunNow(state, { dryRun: false })).toBe(false);
    });

    it("should block a real run when the simulated choices hold fewer choices than the current ones", () => {
      const state = reviewStep({
        options: OPTIONS,
        pairChoices: [CHOICE_ONE, CHOICE_TWO],
        simulatedChoices: [CHOICE_ONE],
        confirmation: { password: PASSWORD, typedTable: TARGET_TABLE },
      });

      expect(canRunNow(state, { dryRun: false })).toBe(false);
    });

    it("should allow a real run when the simulated choices are the same set listed in another order", () => {
      const state = reviewStep({
        options: OPTIONS,
        pairChoices: [CHOICE_ONE, CHOICE_TWO],
        simulatedChoices: [CHOICE_TWO, CHOICE_ONE],
        confirmation: { password: PASSWORD, typedTable: TARGET_TABLE },
      });

      expect(simulationBlockingReason(state)).toBeNull();
      expect(canRunNow(state, { dryRun: false })).toBe(true);
    });

    it("should not require a simulation for a real run when there are no pair choices", () => {
      const state = reviewStep({ options: OPTIONS, simulatedChoices: null, confirmation: { password: PASSWORD, typedTable: TARGET_TABLE } });

      expect(simulationBlockingReason(state)).toBeNull();
      expect(canRunNow(state, { dryRun: false })).toBe(true);
    });

    it("should not block a dry run on the simulation, since a dry run is the simulation", () => {
      const state = reviewStep({ options: OPTIONS, pairChoices: [CHOICE_ONE], simulatedChoices: null, confirmation: { password: PASSWORD, typedTable: "" } });

      expect(canRunNow(state, { dryRun: true })).toBe(true);
    });

    it("should report the completed dry run choices only for a DONE dry run", () => {
      expect(completedDryRunChoicesOf(dryRunSnapshotOf(RunPhase.DONE, [CHOICE_ONE]))).toEqual([CHOICE_ONE]);
    });

    it.each([
      ["a real run that is DONE", dryRunSnapshotOf(RunPhase.DONE, [CHOICE_ONE], false)],
      ["a dry run still RUNNING", dryRunSnapshotOf(RunPhase.RUNNING, [CHOICE_ONE])],
      ["a dry run that FAILED", dryRunSnapshotOf(RunPhase.FAILED, [CHOICE_ONE])],
      ["no run at all (IDLE)", { phase: RunPhase.IDLE } as ActualizarPadronRunSnapshot],
    ])("should report no completed dry run choices for %s", (_label, snapshot) => {
      expect(completedDryRunChoicesOf(snapshot)).toBeNull();
    });

    it("should seed the simulated choices from a completed dry run when the wizard reopens on its result", () => {
      const next = initialWizardStateFor(dryRunSnapshotOf(RunPhase.DONE, [CHOICE_ONE]));

      expect(next.step).toBe(WizardStep.RESULT);
      expect(next.simulatedChoices).toEqual([CHOICE_ONE]);
    });
  });

  describe("persisting a completed analysis", () => {
    const CHOICE: PairChoice = { typePadron: "RURAL", provinceId: 6, localityId: 120, number: "100", oldId: 7 };
    const OPTIONS = { localityType: "LOCALIDAD CATASTRAL", tolerance: "1.0", geometryAreaThresholdPercent: "5", updateGeometries: true, linkAddressMaster: false, repairSequences: false };
    const JOB_ID = "job-analysis-1";

    const persistableState = (overrides: Partial<ActualizarWizardState> = {}): ActualizarWizardState =>
      reviewStep({
        options: OPTIONS,
        pairChoices: [CHOICE],
        simulatedChoices: [CHOICE],
        confirmation: { password: PASSWORD, typedTable: TARGET_TABLE },
        ...overrides,
      });

    const analysisSnapshotOf = (
      phase: RunPhase,
      options: { dryRun?: boolean; result?: ActualizarPadronResult } = {},
    ): ActualizarPadronRunSnapshot => ({
      phase,
      plan: { dryRun: options.dryRun ?? true, destinationTable: TARGET_TABLE, linkAddressMaster: false, repairSequences: false, pairChoices: [CHOICE] },
      ...(options.result === undefined
        ? {}
        : {
            job: {
              jobId: JOB_ID,
              state: phase === RunPhase.DONE ? "DONE" : "RUNNING",
              step: null,
              dryRun: options.dryRun ?? true,
              startedAt: 1,
              result: options.result,
            },
          }),
    });

    describe("persistBlockedReason", () => {
      it("should report the run blocker first when the tolerance is invalid, before the plan and the confirmation", () => {
        const state = persistableState({
          options: { ...OPTIONS, tolerance: "abc" },
          simulatedChoices: null,
          confirmation: { password: "", typedTable: "" },
        });

        expect(persistBlockedReason(state, null)).toBe(MESSAGE_TOLERANCE);
      });

      it("should report the run blocker first when a required table is missing, before the plan and the confirmation", () => {
        const state = persistableState({
          tables: { ...tablesStep().tables, [ActualizarTableKey.LOCALITY]: "" },
          confirmation: { password: "", typedTable: "" },
        });

        expect(persistBlockedReason(state, null)).toBe(MESSAGE_TABLES_MISSING);
      });

      it("should report the missing plan before the confirmation and the simulation", () => {
        const state = persistableState({
          simulatedChoices: null,
          confirmation: { password: "", typedTable: "" },
        });

        expect(persistBlockedReason(state, null)).toBe(MESSAGE_PLAN_MISSING);
      });

      it("should report the missing table name before the simulation when the password is typed and the plan is present", () => {
        const state = persistableState({
          simulatedChoices: null,
          confirmation: { password: PASSWORD, typedTable: "" },
        });

        expect(persistBlockedReason(state, PLAN_ID)).toBe(MESSAGE_CONFIRMATION_TABLE_MISSING);
      });

      it("should report the missing password before the simulation when the table name is typed and the plan is present", () => {
        const state = persistableState({
          simulatedChoices: null,
          confirmation: { password: "", typedTable: TARGET_TABLE },
        });

        expect(persistBlockedReason(state, PLAN_ID)).toBe(MESSAGE_CONFIRMATION_PASSWORD_MISSING);
      });

      it("should report both the missing password and table name before the simulation when neither is typed and the plan is present", () => {
        const state = persistableState({
          simulatedChoices: null,
          confirmation: { password: "", typedTable: "" },
        });

        expect(persistBlockedReason(state, PLAN_ID)).toBe(MESSAGE_CONFIRMATION_BOTH_MISSING);
      });

      it("should report the stale simulation last when the choices differ from the analysed ones", () => {
        const state = persistableState({ simulatedChoices: null });

        expect(persistBlockedReason(state, PLAN_ID)).toBe(MESSAGE_SIMULATION_STALE);
      });

      it("should allow the persist when the input, the plan, the confirmation and the simulation are all in order", () => {
        const state = persistableState();

        expect(persistBlockedReason(state, PLAN_ID)).toBeNull();
      });

      it("should allow the persist of an analysis without pair choices when no simulation is recorded", () => {
        const state = persistableState({ pairChoices: [], simulatedChoices: null });

        expect(persistBlockedReason(state, PLAN_ID)).toBeNull();
      });
    });

    describe("completedAnalysisPlanIdOf", () => {
      it("should return the plan id of a completed dry run that carries one", () => {
        const snapshot = analysisSnapshotOf(RunPhase.DONE, { result: actualizarPadronResultOf({ planId: PLAN_ID }) });

        expect(completedAnalysisPlanIdOf(snapshot)).toBe(PLAN_ID);
      });

      it.each([
        ["a completed real run that carries a plan id", analysisSnapshotOf(RunPhase.DONE, { dryRun: false, result: actualizarPadronResultOf({ planId: PLAN_ID }) })],
        ["a dry run still RUNNING", analysisSnapshotOf(RunPhase.RUNNING, { result: actualizarPadronResultOf({ planId: PLAN_ID }) })],
        ["a dry run that FAILED", analysisSnapshotOf(RunPhase.FAILED, { result: actualizarPadronResultOf({ planId: PLAN_ID }) })],
        ["no run at all (IDLE)", { phase: RunPhase.IDLE } as ActualizarPadronRunSnapshot],
        ["a completed dry run whose result carries no plan id", analysisSnapshotOf(RunPhase.DONE, { result: actualizarPadronResultOf() })],
        ["a completed dry run without a job", analysisSnapshotOf(RunPhase.DONE)],
      ])("should return null for %s", (_label, snapshot) => {
        expect(completedAnalysisPlanIdOf(snapshot)).toBeNull();
      });
    });

    describe("toPersistRequest", () => {
      it("should send the analysis request as a confirmed real run carrying the plan id", () => {
        const state = persistableState();

        const request = toPersistRequest(state, PLAN_ID);

        expect(request.dryRun).toBe(false);
        expect(request.confirm).toBe(true);
        expect(request.planId).toBe(PLAN_ID);
        expect(request).toEqual({ ...toStartRequest(state, { dryRun: true }), dryRun: false, confirm: true, planId: PLAN_ID });
      });

      it("should send the same options and pair choices as the analysis", () => {
        const state = persistableState();

        const request = toPersistRequest(state, PLAN_ID);

        expect(request.options).toEqual(toStartRequest(state, { dryRun: true }).options);
        expect(request.options.pairChoices).toEqual([CHOICE]);
      });

      it("should omit pair choices from the persist request when the analysis had none", () => {
        const request = toPersistRequest(persistableState({ pairChoices: [], simulatedChoices: null }), PLAN_ID);

        expect(request.options).not.toHaveProperty("pairChoices");
      });
    });
  });
});
