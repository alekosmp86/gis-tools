import { createStepTimer, type StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunDeps, RunProgress, RunSession } from "../../cargar-padrones/types";
import { assertConfirmedOrDryRun, assertSourceTablesReady } from "../../shared/preflightAsserts";
import { ADDRESS_MASTER_TOGGLE_MISMATCH_MESSAGE } from "../../shared/addressMasterLinkSpec";
import { withRunSession } from "../../shared/transaction";
import { plannedStepLabels, STEP, type PlannedStepsInput } from "../domain/plannedSteps";
import { paramsFingerprintOf, PLAN_MISSING_MESSAGE, usablePlanOf } from "../domain/plan";
import { assertDistinctPadronTables } from "../domain/tableRoles";
import { buildRunWarnings } from "../domain/warnings";
import type {
  ActualizarPadronParams,
  ActualizarPadronResult,
  ActualizarPlanRecord,
  PadronGeometryChange,
  PadronLayouts,
  PlanSnapshot,
  StepTiming,
} from "../types";
import { assertTargetReady, CONFIRM_REQUIRED_MESSAGE, sourceTablesSpecOf } from "./preflight";
import { savePlanRecord, readPlanRecord, removePlanRecord } from "./planStore";
import { resolvePadronLayouts } from "./resolveLayouts";
import { runAnalysisTransaction, runPersistTransaction, type PadronWriteOutcome } from "./writeSteps";

interface PreparedRun {
  layouts: PadronLayouts;
  localityWarnings: string[];
}

interface AnalysisRun {
  result: ActualizarPadronResult;
  snapshot: PlanSnapshot;
  pendingGeometryChanges: PadronGeometryChange[];
}

function buildResult(
  params: ActualizarPadronParams,
  outcome: PadronWriteOutcome,
  stepTimings: StepTiming[],
  localityWarnings: string[]
): ActualizarPadronResult {
  const { source, target } = outcome;
  const { rowsRead, repaired, skipped } = source.totals;
  const totals = { rowsRead, candidates: rowsRead - skipped, repaired, skipped };
  const { addressMaster, backup } = outcome;
  return {
    dryRun: params.dryRun,
    targetModified: outcome.targetModified,
    outcomeUnknown: outcome.outcomeUnknown,
    totals,
    skipped: source.skipped,
    target,
    ...(addressMaster === undefined ? {} : { addressMaster }),
    ...(backup === undefined ? {} : { backup }),
    warnings: buildRunWarnings({
      dryRun: params.dryRun,
      options: params.options,
      totals,
      target,
      addressMaster,
      collidingKeyCount: source.skipped.collidingKeyCount,
      localityWarnings,
      commitError: outcome.commitError,
      sequenceWarnings: outcome.sequenceWarnings,
    }),
    stepTimings,
  };
}

const plannedInputOf = (params: ActualizarPadronParams): PlannedStepsInput => ({
  dryRun: params.dryRun,
  linkAddressMaster: params.options.linkAddressMaster,
  repairSequences: params.options.repairSequences,
});

const timerOf = (params: ActualizarPadronParams, deps: RunDeps, onProgress?: (progress: RunProgress) => void): StepTimer =>
  createStepTimer({
    now: deps.now,
    total: plannedStepLabels(plannedInputOf(params)).length,
    onProgress,
  });

async function prepareRun(session: RunSession, params: ActualizarPadronParams, timer: StepTimer): Promise<PreparedRun> {
  const layouts: PadronLayouts = await timer.run(STEP.VALIDATE, () => resolvePadronLayouts(session, params));
  const localityWarnings = await timer.run(STEP.TARGET, () => assertTargetReady(session, layouts, params.options.repairSequences));
  await timer.run(STEP.COUNT, () => assertSourceTablesReady(session, sourceTablesSpecOf(layouts)));
  return { layouts, localityWarnings };
}

async function runAnalysisOnSession(
  session: RunSession,
  params: ActualizarPadronParams,
  deps: RunDeps,
  onProgress?: (progress: RunProgress) => void
): Promise<AnalysisRun> {
  const timer = timerOf(params, deps, onProgress);
  const { layouts, localityWarnings } = await prepareRun(session, params, timer);
  const outcome = await runAnalysisTransaction(session, params, layouts, timer);
  return {
    result: buildResult(params, outcome, timer.timings, localityWarnings),
    snapshot: outcome.snapshot,
    pendingGeometryChanges: outcome.pendingGeometryChanges,
  };
}

async function runPersistOnSession(
  session: RunSession,
  params: ActualizarPadronParams,
  deps: RunDeps,
  plan: ActualizarPlanRecord,
  onProgress?: (progress: RunProgress) => void
): Promise<ActualizarPadronResult> {
  const timer = timerOf(params, deps, onProgress);
  const { layouts, localityWarnings } = await prepareRun(session, params, timer);
  const outcome = await runPersistTransaction(session, params, layouts, timer, plan);
  return buildResult(params, outcome, timer.timings, localityWarnings);
}

async function runAnalysis(
  params: ActualizarPadronParams,
  deps: RunDeps,
  onProgress?: (progress: RunProgress) => void
): Promise<ActualizarPadronResult> {
  const { result, snapshot, pendingGeometryChanges } = await withRunSession(params.config, deps, (session) =>
    runAnalysisOnSession(session, params, deps, onProgress)
  );
  const planId = await savePlanRecord(paramsFingerprintOf(params), snapshot, pendingGeometryChanges, deps.now());
  return { ...result, planId };
}

/** Refuses a real run that has no usable plan, before any connection is opened. */
async function requireUsablePlan(params: ActualizarPadronParams, nowMs: number): Promise<ActualizarPlanRecord> {
  if (params.planId === undefined) throw new Error(PLAN_MISSING_MESSAGE);
  const record = await readPlanRecord(params.planId);
  return usablePlanOf(record, paramsFingerprintOf(params), nowMs);
}

async function runPersist(
  params: ActualizarPadronParams,
  deps: RunDeps,
  onProgress?: (progress: RunProgress) => void
): Promise<ActualizarPadronResult> {
  const plan = await requireUsablePlan(params, deps.now());
  const result = await withRunSession(params.config, deps, (session) =>
    runPersistOnSession(session, params, deps, plan, onProgress)
  );
  if (result.targetModified) await removePlanRecord(plan.planId).catch(() => undefined);
  return result;
}

function assertLinkMatchesAddressMasterTable(params: ActualizarPadronParams): void {
  if (params.options.linkAddressMaster !== (params.addressMasterTable !== undefined)) {
    throw new Error(ADDRESS_MASTER_TOGGLE_MISMATCH_MESSAGE);
  }
}

export async function runActualizarPadron(
  params: ActualizarPadronParams,
  deps: RunDeps,
  onProgress?: (progress: RunProgress) => void
): Promise<ActualizarPadronResult> {
  assertLinkMatchesAddressMasterTable(params);
  assertConfirmedOrDryRun(params, CONFIRM_REQUIRED_MESSAGE);
  assertDistinctPadronTables(params);
  return params.dryRun ? runAnalysis(params, deps, onProgress) : runPersist(params, deps, onProgress);
}
