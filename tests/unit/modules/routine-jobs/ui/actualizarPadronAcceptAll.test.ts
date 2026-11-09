import { describe, expect, it } from "vitest";
import type { AcceptedGeometry } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import {
  ActualizarTableKey,
  completedDryRunAcceptAllOf,
  initialWizardState,
  initialWizardStateFor,
  simulationBlockingReason,
  toPersistRequest,
  toStartRequest,
  wizardReducer,
  WizardStep,
  type ActualizarWizardAction,
  type ActualizarWizardState,
} from "@/modules/routine-jobs/ui/actualizarPadronWizardState";
import type { ActualizarPadronRunSnapshot } from "@/modules/routine-jobs/ui/actualizarPadronRunStore";
import { persistDecisionOf, PersistDecisionKind } from "@/modules/routine-jobs/ui/actualizarPersistFlow";
import { RunPhase } from "@/modules/routine-jobs/ui/jobRunStore";

const PASSWORD = "s3cret-pw";
const TARGET_TABLE = "padron_tmp_actualizacion";
const PLAN_ID = "3ab12cd9e8f7d6c5b4a39281706f5e4d";
const MESSAGE_ACCEPTS_STALE = "Analice de nuevo con las geometrías aceptadas actuales antes de persistir.";
const OPTIONS = { localityType: "LOCALIDAD CATASTRAL", tolerance: "1.0", geometryAreaThresholdPercent: "5", updateGeometries: true, linkAddressMaster: false, repairSequences: false };
const ACCEPT_RURAL: AcceptedGeometry = { typePadron: "RURAL", provinceId: 6, localityId: null, number: "501" };

const stateOf = (overrides: Partial<ActualizarWizardState> = {}): ActualizarWizardState => ({
  ...initialWizardState(),
  step: WizardStep.RESULT,
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
  options: OPTIONS,
  confirmation: { password: PASSWORD },
  simulatedChoices: [],
  simulatedAcceptedGeometries: [],
  ...overrides,
});

const dryRunSnapshotOf = (phase: RunPhase, acceptAllGeometries: boolean | undefined, dryRun = true): ActualizarPadronRunSnapshot => ({
  phase,
  plan: { dryRun, destinationTable: TARGET_TABLE, linkAddressMaster: false, repairSequences: false, pairChoices: [], acceptedGeometries: [], acceptAllGeometries },
});

describe("accept-all geometries wizard state (AP-116)", () => {
  it("should start with the flag off, no count and no simulated flag", () => {
    const initial = initialWizardState();

    expect(initial.acceptAllGeometries).toBe(false);
    expect(initial.acceptAllCount).toBe(0);
    expect(initial.simulatedAcceptAllGeometries).toBe(false);
  });

  it("should turn the flag on and keep the pending total when acceptAllGeometriesSet is dispatched on", () => {
    const next = wizardReducer(stateOf(), { type: "acceptAllGeometriesSet", value: true, count: 42 });

    expect(next.acceptAllGeometries).toBe(true);
    expect(next.acceptAllCount).toBe(42);
  });

  it("should record a zero count when the flag is set on without a count", () => {
    const next = wizardReducer(stateOf(), { type: "acceptAllGeometriesSet", value: true });

    expect(next.acceptAllCount).toBe(0);
  });

  it("should turn the flag off and clear the count when acceptAllGeometriesSet is dispatched off", () => {
    const state = stateOf({ acceptAllGeometries: true, acceptAllCount: 42 });

    const next = wizardReducer(state, { type: "acceptAllGeometriesSet", value: false, count: 42 });

    expect(next.acceptAllGeometries).toBe(false);
    expect(next.acceptAllCount).toBe(0);
  });

  it("should leave the listed accepted geometries alone when the flag changes", () => {
    const next = wizardReducer(stateOf({ acceptedGeometries: [ACCEPT_RURAL] }), { type: "acceptAllGeometriesSet", value: true, count: 3 });

    expect(next.acceptedGeometries).toEqual([ACCEPT_RURAL]);
  });

  it.each<readonly [string, ActualizarWizardAction]>([
    ["a table chosen under another name", { type: "tableChosen", key: ActualizarTableKey.TARGET, table: "padron_otro", valid: true }],
    ["the staging schema changed", { type: "schemaChanged", field: "stagingSchema", value: "otro_esquema" }],
    ["an option changed", { type: "optionsChanged", patch: { tolerance: "2.5" } }],
    ["the connection host changed", { type: "connectionChanged", field: "host", value: "otro.local" }],
    ["the wizard was reset for a new load", { type: "reset" }],
  ])("should clear the flag and its count when %s", (_label, action) => {
    const next = wizardReducer(stateOf({ acceptAllGeometries: true, acceptAllCount: 9 }), action);

    expect(next.acceptAllGeometries).toBe(false);
    expect(next.acceptAllCount).toBe(0);
  });

  it("should keep the flag when only the password changes", () => {
    const next = wizardReducer(stateOf({ acceptAllGeometries: true, acceptAllCount: 9 }), { type: "connectionChanged", field: "password", value: "otra-clave" });

    expect(next.acceptAllGeometries).toBe(true);
  });

  it("should clear the flag when Actualizar geometrías is switched off", () => {
    const next = wizardReducer(stateOf({ acceptAllGeometries: true, acceptAllCount: 9 }), { type: "optionsChanged", patch: { updateGeometries: false } });

    expect(next.acceptAllGeometries).toBe(false);
  });
});

describe("accept-all geometries requests (AP-116)", () => {
  it("should send acceptAllGeometries true in the start request when the flag and updateGeometries are on", () => {
    const request = toStartRequest(stateOf({ acceptAllGeometries: true }), { dryRun: true });

    expect(request.options.acceptAllGeometries).toBe(true);
  });

  it("should omit the flag from the start request when it is off", () => {
    const request = toStartRequest(stateOf(), { dryRun: true });

    expect(request.options).not.toHaveProperty("acceptAllGeometries");
  });

  it("should omit the flag from the start request when updateGeometries is off even if the flag is on", () => {
    const state = stateOf({ acceptAllGeometries: true, options: { ...OPTIONS, updateGeometries: false } });

    expect(toStartRequest(state, { dryRun: true }).options).not.toHaveProperty("acceptAllGeometries");
  });

  it("should send the flag in the persist request with the plan id", () => {
    const request = toPersistRequest(stateOf({ acceptAllGeometries: true, simulatedAcceptAllGeometries: true }), PLAN_ID);

    expect(request).toMatchObject({ dryRun: false, confirm: true, planId: PLAN_ID });
    expect(request.options.acceptAllGeometries).toBe(true);
  });
});

describe("accept-all geometries simulation (AP-117)", () => {
  it("should block with the accepts stale message when the flag is on and the last analysis had it off", () => {
    const state = stateOf({ acceptAllGeometries: true, simulatedAcceptAllGeometries: false });

    expect(simulationBlockingReason(state)).toBe(MESSAGE_ACCEPTS_STALE);
  });

  it("should block with the accepts stale message when the flag is off and the last analysis had it on", () => {
    const state = stateOf({ acceptAllGeometries: false, simulatedAcceptAllGeometries: true });

    expect(simulationBlockingReason(state)).toBe(MESSAGE_ACCEPTS_STALE);
  });

  it("should not block when the flag equals the one of the last analysis", () => {
    expect(simulationBlockingReason(stateOf({ acceptAllGeometries: true, simulatedAcceptAllGeometries: true }))).toBeNull();
    expect(simulationBlockingReason(stateOf())).toBeNull();
  });

  it("should decide to analyze then persist when only the flag is stale", () => {
    const state = stateOf({ acceptAllGeometries: true, simulatedAcceptAllGeometries: false });

    expect(persistDecisionOf(state, PLAN_ID).kind).toBe(PersistDecisionKind.ANALYZE_THEN_PERSIST);
  });

  it("should decide to persist now when the flag matches the last analysis", () => {
    const state = stateOf({ acceptAllGeometries: true, simulatedAcceptAllGeometries: true });

    expect(persistDecisionOf(state, PLAN_ID)).toEqual({ kind: PersistDecisionKind.PERSIST_NOW, planId: PLAN_ID });
  });

  it("should record the flag of a completed dry run as the simulated flag", () => {
    const next = wizardReducer(stateOf({ acceptAllGeometries: true, simulatedAcceptAllGeometries: false }), {
      type: "dryRunCompleted",
      choices: [],
      acceptedGeometries: [],
      acceptAllGeometries: true,
    });

    expect(next.simulatedAcceptAllGeometries).toBe(true);
    expect(simulationBlockingReason(next)).toBeNull();
  });

  it("should record a false simulated flag when the completed dry run carries none", () => {
    const next = wizardReducer(stateOf({ simulatedAcceptAllGeometries: true }), { type: "dryRunCompleted", choices: [] });

    expect(next.simulatedAcceptAllGeometries).toBe(false);
  });
});

describe("accept-all buttons only flag the choice (AP-118)", () => {
  it("should hold the flag and the pending total after Aceptar todas, leaving the step and run flags untouched", () => {
    const before = stateOf();

    const next = wizardReducer(before, { type: "acceptAllGeometriesSet", value: true, count: 12 });

    expect(next.acceptAllGeometries).toBe(true);
    expect(next.acceptAllCount).toBe(12);
    expect(next.step).toBe(before.step);
    expect(next.simulatedAcceptAllGeometries).toBe(before.simulatedAcceptAllGeometries);
    expect(next.simulatedChoices).toEqual(before.simulatedChoices);
  });

  it("should not mark the flag as simulated, since no analysis ran", () => {
    const next = wizardReducer(stateOf(), { type: "acceptAllGeometriesSet", value: true, count: 12 });

    expect(next.simulatedAcceptAllGeometries).toBe(false);
  });

  it("should clear the flag with count 0 after Rechazar todas", () => {
    const on = wizardReducer(stateOf(), { type: "acceptAllGeometriesSet", value: true, count: 12 });

    const off = wizardReducer(on, { type: "acceptAllGeometriesSet", value: false });

    expect(off.acceptAllGeometries).toBe(false);
    expect(off.acceptAllCount).toBe(0);
    expect(off.step).toBe(on.step);
  });

  it("should decide to analyze then persist after Aceptar todas on a fresh analysis", () => {
    const next = wizardReducer(stateOf(), { type: "acceptAllGeometriesSet", value: true, count: 12 });

    expect(persistDecisionOf(next, PLAN_ID).kind).toBe(PersistDecisionKind.ANALYZE_THEN_PERSIST);
  });

  it("should carry acceptAllGeometries true in the persist request built from the state after Aceptar todas", () => {
    const next = wizardReducer(stateOf(), { type: "acceptAllGeometriesSet", value: true, count: 12 });

    const request = toPersistRequest(next, PLAN_ID);

    expect(request.dryRun).toBe(false);
    expect(request.options.acceptAllGeometries).toBe(true);
  });

  it("should decide to analyze then persist after Rechazar todas following an analysis that had the flag on", () => {
    const analyzed = stateOf({ acceptAllGeometries: true, acceptAllCount: 12, simulatedAcceptAllGeometries: true });

    const next = wizardReducer(analyzed, { type: "acceptAllGeometriesSet", value: false });

    expect(persistDecisionOf(next, PLAN_ID).kind).toBe(PersistDecisionKind.ANALYZE_THEN_PERSIST);
  });
});

describe("accept-all geometries on a reopened wizard (AP-117)", () => {
  it("should report the flag of a DONE dry run", () => {
    expect(completedDryRunAcceptAllOf(dryRunSnapshotOf(RunPhase.DONE, true))).toBe(true);
    expect(completedDryRunAcceptAllOf(dryRunSnapshotOf(RunPhase.DONE, false))).toBe(false);
    expect(completedDryRunAcceptAllOf(dryRunSnapshotOf(RunPhase.DONE, undefined))).toBe(false);
  });

  it.each([
    ["a real run that is DONE", dryRunSnapshotOf(RunPhase.DONE, true, false)],
    ["a dry run still RUNNING", dryRunSnapshotOf(RunPhase.RUNNING, true)],
    ["a dry run that FAILED", dryRunSnapshotOf(RunPhase.FAILED, true)],
    ["no run at all (IDLE)", { phase: RunPhase.IDLE } as ActualizarPadronRunSnapshot],
  ])("should report no completed flag for %s", (_label, snapshot) => {
    expect(completedDryRunAcceptAllOf(snapshot)).toBeNull();
  });

  it("should seed the flag and the simulated flag from a completed dry run that had it on", () => {
    const next = initialWizardStateFor(dryRunSnapshotOf(RunPhase.DONE, true));

    expect(next.step).toBe(WizardStep.RESULT);
    expect(next.acceptAllGeometries).toBe(true);
    expect(next.simulatedAcceptAllGeometries).toBe(true);
    expect(next.acceptAllCount).toBe(0);
  });

  it("should seed the flag from the in-flight plan without marking it simulated", () => {
    const next = initialWizardStateFor(dryRunSnapshotOf(RunPhase.RUNNING, true));

    expect(next.acceptAllGeometries).toBe(true);
    expect(next.simulatedAcceptAllGeometries).toBe(false);
  });

  it("should seed the flag off for a plan built before the flag existed", () => {
    const next = initialWizardStateFor(dryRunSnapshotOf(RunPhase.DONE, undefined));

    expect(next.acceptAllGeometries).toBe(false);
    expect(next.simulatedAcceptAllGeometries).toBe(false);
  });
});
