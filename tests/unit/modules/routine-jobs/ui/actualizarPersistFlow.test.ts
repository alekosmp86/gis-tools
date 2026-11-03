import { describe, expect, it } from "vitest";
import type { AcceptedGeometry, PairChoice } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import {
  ActualizarTableKey,
  initialWizardState,
  WizardStep,
  type ActualizarWizardState,
} from "@/modules/routine-jobs/ui/actualizarPadronWizardState";
import type { ActualizarPadronRunSnapshot } from "@/modules/routine-jobs/ui/actualizarPadronRunStore";
import {
  AutoPersistOutcomeKind,
  autoPersistOutcomeOf,
  createAutoPersistController,
  persistBlockReasonOf,
  persistDecisionOf,
  PersistDecisionKind,
  persistNoticeOf,
  REANALYZE_NOTICE,
} from "@/modules/routine-jobs/ui/actualizarPersistFlow";
import { RunPhase } from "@/modules/routine-jobs/ui/jobRunStore";

const PASSWORD = "s3cret-pw";
const TARGET_TABLE = "padron_tmp_actualizacion";
const PLAN_ID = "3ab12cd9e8f7d6c5b4a39281706f5e4d";
const NEW_PLAN_ID = "99ff00aa11bb22cc33dd44ee55ff6677";
const PREVIOUS_JOB = "job-analysis-1";
const NEW_JOB = "job-analysis-2";
const MESSAGE_PLAN_MISSING = "El análisis no dejó un plan para guardar: vuelva a analizar.";

const PAIR: PairChoice = { typePadron: "RURAL", provinceId: 6, localityId: 120, number: "100", oldId: 7 };
const ACCEPT: AcceptedGeometry = { typePadron: "RURAL", provinceId: 6, localityId: null, number: "501" };

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
  options: { localityType: "LOCALIDAD CATASTRAL", tolerance: "1.0", geometryAreaThresholdPercent: "5", updateGeometries: true, linkAddressMaster: false },
  confirmation: { password: PASSWORD, typedTable: TARGET_TABLE },
  simulatedChoices: [],
  simulatedAcceptedGeometries: [],
  ...overrides,
});

describe("persistDecisionOf", () => {
  it("should persist now when the selection equals the last analysis", () => {
    const state = stateOf({ pairChoices: [PAIR], simulatedChoices: [PAIR] });

    const decision = persistDecisionOf(state, PLAN_ID);

    expect(decision).toEqual({ kind: PersistDecisionKind.PERSIST_NOW, planId: PLAN_ID });
    expect(persistBlockReasonOf(decision)).toBeNull();
    expect(persistNoticeOf(decision)).toBeNull();
  });

  it("should analyze first when the pair choices changed after the analysis", () => {
    const state = stateOf({ pairChoices: [PAIR] });

    const decision = persistDecisionOf(state, PLAN_ID);

    expect(decision.kind).toBe(PersistDecisionKind.ANALYZE_THEN_PERSIST);
    expect(persistBlockReasonOf(decision)).toBeNull();
    expect(persistNoticeOf(decision)).toBe(REANALYZE_NOTICE);
  });

  it("should analyze first when every choice was cleared after an analysis that had choices", () => {
    const state = stateOf({ pairChoices: [], simulatedChoices: [PAIR] });

    expect(persistDecisionOf(state, PLAN_ID).kind).toBe(PersistDecisionKind.ANALYZE_THEN_PERSIST);
  });

  it("should analyze first when the accepted geometries changed after the analysis", () => {
    const state = stateOf({ acceptedGeometries: [ACCEPT] });

    expect(persistDecisionOf(state, PLAN_ID).kind).toBe(PersistDecisionKind.ANALYZE_THEN_PERSIST);
  });

  it("should stay blocked without a plan even when the selection is stale", () => {
    const state = stateOf({ pairChoices: [PAIR] });

    const decision = persistDecisionOf(state, null);

    expect(decision).toEqual({ kind: PersistDecisionKind.BLOCKED, reason: MESSAGE_PLAN_MISSING });
    expect(persistNoticeOf(decision)).toBeNull();
  });

  it("should stay blocked when the confirmation is incomplete even when the selection is stale", () => {
    const state = stateOf({ pairChoices: [PAIR], confirmation: { password: PASSWORD, typedTable: "" } });

    const decision = persistDecisionOf(state, PLAN_ID);

    expect(decision.kind).toBe(PersistDecisionKind.BLOCKED);
    expect(persistBlockReasonOf(decision)).not.toBeNull();
  });
});

const targetOf = (overrides: { choicesUnapplied?: number; geometryAcceptsUnapplied?: number } = {}) =>
  ({ choicesUnapplied: 0, geometryAcceptsUnapplied: 0, ...overrides }) as never;

const snapshotOf = (
  phase: RunPhase,
  options: { jobId?: string; dryRun?: boolean; planId?: string; target?: unknown } = {},
): ActualizarPadronRunSnapshot =>
  ({
    phase,
    jobId: options.jobId,
    plan: { dryRun: options.dryRun ?? true, destinationTable: TARGET_TABLE, linkAddressMaster: false, pairChoices: [] },
    job: { state: "DONE", result: { dryRun: options.dryRun ?? true, planId: options.planId, target: options.target ?? targetOf() } },
  }) as unknown as ActualizarPadronRunSnapshot;

describe("autoPersistOutcomeOf", () => {
  it("should wait while the analysis starts or runs", () => {
    expect(autoPersistOutcomeOf(snapshotOf(RunPhase.STARTING), PREVIOUS_JOB).kind).toBe(AutoPersistOutcomeKind.WAIT);
    expect(autoPersistOutcomeOf(snapshotOf(RunPhase.RUNNING, { jobId: NEW_JOB }), PREVIOUS_JOB).kind).toBe(AutoPersistOutcomeKind.WAIT);
  });

  it("should wait while the snapshot is still the previous job", () => {
    const snapshot = snapshotOf(RunPhase.DONE, { jobId: PREVIOUS_JOB, planId: PLAN_ID });

    expect(autoPersistOutcomeOf(snapshot, PREVIOUS_JOB).kind).toBe(AutoPersistOutcomeKind.WAIT);
  });

  it("should persist the new plan when the analysis is done and applied everything", () => {
    const snapshot = snapshotOf(RunPhase.DONE, { jobId: NEW_JOB, planId: NEW_PLAN_ID });

    expect(autoPersistOutcomeOf(snapshot, PREVIOUS_JOB)).toEqual({ kind: AutoPersistOutcomeKind.PERSIST, planId: NEW_PLAN_ID });
  });

  it("should stop when the analysis result carries no plan", () => {
    const snapshot = snapshotOf(RunPhase.DONE, { jobId: NEW_JOB });

    expect(autoPersistOutcomeOf(snapshot, PREVIOUS_JOB).kind).toBe(AutoPersistOutcomeKind.STOP);
  });

  it("should stop when a pair choice was not applied", () => {
    const snapshot = snapshotOf(RunPhase.DONE, { jobId: NEW_JOB, planId: NEW_PLAN_ID, target: targetOf({ choicesUnapplied: 2 }) });

    expect(autoPersistOutcomeOf(snapshot, PREVIOUS_JOB).kind).toBe(AutoPersistOutcomeKind.STOP);
  });

  it("should stop when an accepted geometry was not applied", () => {
    const snapshot = snapshotOf(RunPhase.DONE, { jobId: NEW_JOB, planId: NEW_PLAN_ID, target: targetOf({ geometryAcceptsUnapplied: 1 }) });

    expect(autoPersistOutcomeOf(snapshot, PREVIOUS_JOB).kind).toBe(AutoPersistOutcomeKind.STOP);
  });

  it("should read an absent geometry unapplied count as zero", () => {
    const snapshot = snapshotOf(RunPhase.DONE, { jobId: NEW_JOB, planId: NEW_PLAN_ID, target: { choicesUnapplied: 0 } });

    expect(autoPersistOutcomeOf(snapshot, PREVIOUS_JOB).kind).toBe(AutoPersistOutcomeKind.PERSIST);
  });

  it("should stop when the analysis failed, is unknown or was reset", () => {
    expect(autoPersistOutcomeOf(snapshotOf(RunPhase.FAILED), PREVIOUS_JOB).kind).toBe(AutoPersistOutcomeKind.STOP);
    expect(autoPersistOutcomeOf(snapshotOf(RunPhase.UNKNOWN), PREVIOUS_JOB).kind).toBe(AutoPersistOutcomeKind.STOP);
    expect(autoPersistOutcomeOf({ phase: RunPhase.IDLE }, PREVIOUS_JOB).kind).toBe(AutoPersistOutcomeKind.STOP);
  });

  it("should stop when the finished job is not an analysis", () => {
    const snapshot = snapshotOf(RunPhase.DONE, { jobId: NEW_JOB, dryRun: false, planId: NEW_PLAN_ID });

    expect(autoPersistOutcomeOf(snapshot, PREVIOUS_JOB).kind).toBe(AutoPersistOutcomeKind.STOP);
  });
});

describe("createAutoPersistController", () => {
  const storeOf = (initial: ActualizarPadronRunSnapshot) => {
    let current = initial;
    const listeners = new Set<() => void>();
    return {
      getSnapshot: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      publish: (next: ActualizarPadronRunSnapshot) => {
        current = next;
        listeners.forEach((listener) => listener());
      },
      listenerCount: () => listeners.size,
    };
  };

  it("should settle once with the persist outcome when the new analysis is done", () => {
    const store = storeOf(snapshotOf(RunPhase.DONE, { jobId: PREVIOUS_JOB, planId: PLAN_ID }));
    const settled: unknown[] = [];
    createAutoPersistControllerFor(store, settled);

    store.publish(snapshotOf(RunPhase.STARTING));
    store.publish(snapshotOf(RunPhase.DONE, { jobId: NEW_JOB, planId: NEW_PLAN_ID }));
    store.publish(snapshotOf(RunPhase.DONE, { jobId: NEW_JOB, planId: NEW_PLAN_ID }));

    expect(settled).toEqual([{ kind: AutoPersistOutcomeKind.PERSIST, planId: NEW_PLAN_ID }]);
    expect(store.listenerCount()).toBe(0);
  });

  it("should settle with stop when the analysis fails", () => {
    const store = storeOf(snapshotOf(RunPhase.DONE, { jobId: PREVIOUS_JOB, planId: PLAN_ID }));
    const settled: unknown[] = [];
    createAutoPersistControllerFor(store, settled);

    store.publish(snapshotOf(RunPhase.FAILED));

    expect(settled).toEqual([{ kind: AutoPersistOutcomeKind.STOP }]);
  });

  it("should never settle after being cancelled", () => {
    const store = storeOf(snapshotOf(RunPhase.DONE, { jobId: PREVIOUS_JOB, planId: PLAN_ID }));
    const settled: unknown[] = [];
    const controller = createAutoPersistControllerFor(store, settled);

    controller.cancel();
    store.publish(snapshotOf(RunPhase.DONE, { jobId: NEW_JOB, planId: NEW_PLAN_ID }));

    expect(settled).toEqual([]);
    expect(store.listenerCount()).toBe(0);
  });

  function createAutoPersistControllerFor(store: ReturnType<typeof storeOf>, settled: unknown[]) {
    const controller = createAutoPersistController(store);
    controller.begin((outcome) => settled.push(outcome));
    return controller;
  }
});
