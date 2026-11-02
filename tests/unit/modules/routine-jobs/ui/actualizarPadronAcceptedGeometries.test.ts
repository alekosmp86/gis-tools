import { describe, expect, it } from "vitest";
import type { AcceptedGeometry, PairChoice } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import {
  ActualizarTableKey,
  canRunNow,
  initialWizardState,
  initialWizardStateFor,
  persistBlockedReason,
  simulationBlockingReason,
  toPersistRequest,
  toStartRequest,
  wizardReducer,
  WizardStep,
  type ActualizarWizardAction,
  type ActualizarWizardState,
} from "@/modules/routine-jobs/ui/actualizarPadronWizardState";
import type { ActualizarPadronRunSnapshot } from "@/modules/routine-jobs/ui/actualizarPadronRunStore";
import { RunPhase } from "@/modules/routine-jobs/ui/jobRunStore";

const PASSWORD = "s3cret-pw";
const TARGET_TABLE = "padron_tmp_actualizacion";
const PLAN_ID = "3ab12cd9e8f7d6c5b4a39281706f5e4d";
const MESSAGE_ACCEPTS_STALE = "Analice de nuevo con las geometrías aceptadas actuales antes de persistir.";
const MESSAGE_SIMULATION_STALE = "Analice de nuevo con la selección de pares actual antes de persistir.";
const MESSAGE_PLAN_MISSING = "El análisis no dejó un plan para guardar: vuelva a analizar.";

const OPTIONS = { localityType: "LOCALIDAD CATASTRAL", tolerance: "1.0", geometryAreaThresholdPercent: "5", updateGeometries: true, linkAddressMaster: false };

const ACCEPT_RURAL: AcceptedGeometry = { typePadron: "RURAL", provinceId: 6, localityId: null, number: "501" };
const ACCEPT_URBANO: AcceptedGeometry = { typePadron: "URBANO", provinceId: 6, localityId: 120, number: "502" };
const PAIR: PairChoice = { typePadron: "RURAL", provinceId: 6, localityId: 120, number: "100", oldId: 7 };

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
  options: OPTIONS,
  ...overrides,
});

const reviewStep = (overrides: Partial<ActualizarWizardState> = {}): ActualizarWizardState => ({
  ...tablesStep(overrides),
  step: WizardStep.REVIEW,
});

const decided = (overrides: Partial<ActualizarWizardState> = {}): ActualizarWizardState =>
  reviewStep({
    confirmation: { password: PASSWORD, typedTable: TARGET_TABLE },
    acceptedGeometries: [ACCEPT_RURAL],
    simulatedAcceptedGeometries: [ACCEPT_RURAL],
    removalMarks: [500, 600],
    ...overrides,
  });

const CLEARING_EVENTS: ReadonlyArray<readonly [string, ActualizarWizardAction]> = [
  ["a table chosen under another name", { type: "tableChosen", key: ActualizarTableKey.TARGET, table: "padron_otro", valid: true }],
  ["the staging schema changed", { type: "schemaChanged", field: "stagingSchema", value: "otro_esquema" }],
  ["the carto schema changed", { type: "schemaChanged", field: "cartoSchema", value: "otro_carto" }],
  ["an option changed", { type: "optionsChanged", patch: { tolerance: "2.5" } }],
  ["the connection host changed", { type: "connectionChanged", field: "host", value: "otro.local" }],
  ["the wizard was reset for a new load", { type: "reset" }],
];

describe("accepted geometries reducer (AP-100)", () => {
  it("should store the accepted keys when geometriesAccepted is dispatched", () => {
    const next = wizardReducer(tablesStep(), { type: "geometriesAccepted", accepts: [ACCEPT_RURAL, ACCEPT_URBANO] });

    expect(next.acceptedGeometries).toEqual([ACCEPT_RURAL, ACCEPT_URBANO]);
  });

  it("should hold an accepted key once when the same key is accepted again", () => {
    const once = wizardReducer(tablesStep(), { type: "geometriesAccepted", accepts: [ACCEPT_RURAL] });

    const twice = wizardReducer(once, { type: "geometriesAccepted", accepts: [ACCEPT_RURAL] });

    expect(twice.acceptedGeometries).toEqual([ACCEPT_RURAL]);
  });

  it("should remove only the rejected keys when geometriesRejected is dispatched", () => {
    const state = tablesStep({ acceptedGeometries: [ACCEPT_RURAL, ACCEPT_URBANO] });

    const next = wizardReducer(state, { type: "geometriesRejected", accepts: [ACCEPT_RURAL] });

    expect(next.acceptedGeometries).toEqual([ACCEPT_URBANO]);
  });

  it("should leave the pair choices and the removal marks alone when geometries are accepted", () => {
    const state = tablesStep({ pairChoices: [PAIR], removalMarks: [500] });

    const next = wizardReducer(state, { type: "geometriesAccepted", accepts: [ACCEPT_RURAL] });

    expect(next.pairChoices).toEqual([PAIR]);
    expect(next.removalMarks).toEqual([500]);
  });
});

describe("removal marks reducer (AP-101)", () => {
  it("should record each marked old id once, in mark order", () => {
    const first = wizardReducer(tablesStep(), { type: "removalMarked", oldIds: [500, 600] });

    const second = wizardReducer(first, { type: "removalMarked", oldIds: [600, 700] });

    expect(second.removalMarks).toEqual([500, 600, 700]);
  });

  it("should remove only the unmarked old ids when removalUnmarked is dispatched", () => {
    const state = tablesStep({ removalMarks: [500, 600] });

    const next = wizardReducer(state, { type: "removalUnmarked", oldIds: [500] });

    expect(next.removalMarks).toEqual([600]);
  });

  it("should leave the accepted geometries and the pair choices alone when a padron is marked", () => {
    const state = tablesStep({ acceptedGeometries: [ACCEPT_RURAL], pairChoices: [PAIR] });

    const next = wizardReducer(state, { type: "removalMarked", oldIds: [500] });

    expect(next.acceptedGeometries).toEqual([ACCEPT_RURAL]);
    expect(next.pairChoices).toEqual([PAIR]);
  });
});

describe("clearing the decisions with the pair choices (AP-100, AP-101)", () => {
  it.each(CLEARING_EVENTS)("should clear the accepted geometries, the removal marks and the pair choices when %s", (_label, action) => {
    const state = tablesStep({ acceptedGeometries: [ACCEPT_RURAL], removalMarks: [500], pairChoices: [PAIR] });

    const next = wizardReducer(state, action);

    expect(next.acceptedGeometries).toEqual([]);
    expect(next.removalMarks).toEqual([]);
    expect(next.pairChoices).toEqual([]);
  });

  it("should keep the accepted geometries and the marks when a table is chosen with the name it already had", () => {
    const state = tablesStep({ acceptedGeometries: [ACCEPT_RURAL], removalMarks: [500] });

    const next = wizardReducer(state, { type: "tableChosen", key: ActualizarTableKey.TARGET, table: TARGET_TABLE, valid: true });

    expect(next.acceptedGeometries).toEqual([ACCEPT_RURAL]);
    expect(next.removalMarks).toEqual([500]);
  });

  it("should keep the accepted geometries and the marks when an option is set to the value it already has", () => {
    const state = tablesStep({ acceptedGeometries: [ACCEPT_RURAL], removalMarks: [500] });

    const next = wizardReducer(state, { type: "optionsChanged", patch: { tolerance: OPTIONS.tolerance } });

    expect(next.acceptedGeometries).toEqual([ACCEPT_RURAL]);
    expect(next.removalMarks).toEqual([500]);
  });

  it("should keep the accepted geometries when only the password changes, as the pair choices do", () => {
    const state = tablesStep({ acceptedGeometries: [ACCEPT_RURAL] });

    const next = wizardReducer(state, { type: "connectionChanged", field: "password", value: "otra-clave" });

    expect(next.acceptedGeometries).toEqual([ACCEPT_RURAL]);
  });

  it("should start with no accepted geometries and no removal marks when the wizard opens", () => {
    const initial = initialWizardState();

    expect(initial.acceptedGeometries).toEqual([]);
    expect(initial.simulatedAcceptedGeometries).toBeNull();
    expect(initial.removalMarks).toEqual([]);
  });
});

describe("simulation of the accepted geometries (AP-100)", () => {
  it("should block a real run with the accepted geometries message when they differ from the last analysis", () => {
    const state = decided({ simulatedAcceptedGeometries: [] });

    expect(simulationBlockingReason(state)).toBe(MESSAGE_ACCEPTS_STALE);
    expect(canRunNow(state, { dryRun: false })).toBe(false);
  });

  it("should still let a dry run go ahead when the accepted geometries differ, since a dry run is the analysis", () => {
    const state = decided({ simulatedAcceptedGeometries: [] });

    expect(canRunNow(state, { dryRun: true })).toBe(true);
  });

  it("should block the persist with the accepted geometries message when only the accepts are stale", () => {
    const state = decided({ simulatedAcceptedGeometries: [] });

    expect(persistBlockedReason(state, PLAN_ID)).toBe(MESSAGE_ACCEPTS_STALE);
  });

  it("should block the persist when the acceptances were all removed after an analysis that had them", () => {
    const state = decided({ acceptedGeometries: [], simulatedAcceptedGeometries: [ACCEPT_RURAL] });

    expect(persistBlockedReason(state, PLAN_ID)).toBe(MESSAGE_ACCEPTS_STALE);
  });

  it("should allow the persist when the accepted geometries are the same set listed in another order", () => {
    const state = decided({
      acceptedGeometries: [ACCEPT_RURAL, ACCEPT_URBANO],
      simulatedAcceptedGeometries: [ACCEPT_URBANO, ACCEPT_RURAL],
    });

    expect(simulationBlockingReason(state)).toBeNull();
    expect(persistBlockedReason(state, PLAN_ID)).toBeNull();
  });

  it("should report the pair-choice message first when both the pairs and the accepted geometries are stale", () => {
    const state = decided({ pairChoices: [PAIR], simulatedChoices: null, simulatedAcceptedGeometries: [] });

    expect(persistBlockedReason(state, PLAN_ID)).toBe(MESSAGE_SIMULATION_STALE);
  });

  it("should report the missing plan before the accepted geometries when there is no plan", () => {
    const state = decided({ simulatedAcceptedGeometries: [] });

    expect(persistBlockedReason(state, null)).toBe(MESSAGE_PLAN_MISSING);
  });

  it("should record the acceptances of a completed dry run as the simulated acceptances", () => {
    const next = wizardReducer(reviewStep({ acceptedGeometries: [ACCEPT_RURAL] }), {
      type: "dryRunCompleted",
      choices: [],
      acceptedGeometries: [ACCEPT_RURAL],
    });

    expect(next.simulatedAcceptedGeometries).toEqual([ACCEPT_RURAL]);
    expect(simulationBlockingReason(next)).toBeNull();
  });

  it("should record no simulated acceptances when a completed dry run carries none", () => {
    const next = wizardReducer(reviewStep({ acceptedGeometries: [] }), { type: "dryRunCompleted", choices: [] });

    expect(next.simulatedAcceptedGeometries).toEqual([]);
  });

  it("should seed the simulated acceptances from a completed dry run when the wizard reopens on its result", () => {
    const snapshot: ActualizarPadronRunSnapshot = {
      phase: RunPhase.DONE,
      plan: { dryRun: true, destinationTable: TARGET_TABLE, linkAddressMaster: false, pairChoices: [], acceptedGeometries: [ACCEPT_RURAL] },
    };

    const next = initialWizardStateFor(snapshot);

    expect(next.step).toBe(WizardStep.RESULT);
    expect(next.acceptedGeometries).toEqual([ACCEPT_RURAL]);
    expect(next.simulatedAcceptedGeometries).toEqual([ACCEPT_RURAL]);
  });
});

describe("start and persist requests carry the accepted geometries and never the removal marks (AP-100, AP-101)", () => {
  it("should send the accepted geometries in the start request options", () => {
    const request = toStartRequest(decided({ removalMarks: [] }), { dryRun: true });

    expect(request.options.acceptedGeometries).toEqual([ACCEPT_RURAL]);
  });

  it("should omit the accepted geometries from the start request when none are accepted", () => {
    const request = toStartRequest(decided({ acceptedGeometries: [], simulatedAcceptedGeometries: [] }), { dryRun: true });

    expect(request.options).not.toHaveProperty("acceptedGeometries");
  });

  it("should send the same accepted geometries in the persist request, with the plan id and a confirmed real run", () => {
    const state = decided({ acceptedGeometries: [ACCEPT_RURAL, ACCEPT_URBANO], simulatedAcceptedGeometries: [ACCEPT_RURAL, ACCEPT_URBANO] });

    const request = toPersistRequest(state, PLAN_ID);

    expect(request).toMatchObject({ dryRun: false, confirm: true, planId: PLAN_ID });
    expect(request.options.acceptedGeometries).toEqual([ACCEPT_RURAL, ACCEPT_URBANO]);
    expect(request.options).toEqual(toStartRequest(state, { dryRun: true }).options);
  });

  it("should never send the removal marks in the start request, nor anywhere in its body", () => {
    const request = toStartRequest(decided({ removalMarks: [500, 600] }), { dryRun: true });

    expect(request).not.toHaveProperty("removalMarks");
    expect(request.options).not.toHaveProperty("removalMarks");
    expect(JSON.stringify(request)).not.toContain("removalMarks");
  });

  it("should never send the removal marks in the persist request, even when no geometry is accepted", () => {
    const state = decided({ acceptedGeometries: [], simulatedAcceptedGeometries: [], removalMarks: [500, 600] });

    const request = toPersistRequest(state, PLAN_ID);

    expect(request).not.toHaveProperty("removalMarks");
    expect(request.options).not.toHaveProperty("acceptedGeometries");
    expect(JSON.stringify(request)).not.toContain("removalMarks");
  });
});
