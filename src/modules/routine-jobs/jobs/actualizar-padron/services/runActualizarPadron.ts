import { createStepTimer, type StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunDeps, RunProgress, RunSession } from "../../cargar-padrones/types";
import { assertConfirmedOrDryRun, assertSourceTablesReady } from "../../shared/preflightAsserts";
import { withRunSession } from "../../shared/transaction";
import { plannedStepLabels, STEP, type PlannedStepsInput } from "../domain/plannedSteps";
import { assertDistinctPadronTables } from "../domain/tableRoles";
import { buildRunWarnings } from "../domain/warnings";
import type { ActualizarPadronParams, ActualizarPadronResult, PadronLayouts, StepTiming } from "../types";
import { assertTargetReady, CONFIRM_REQUIRED_MESSAGE, sourceTablesSpecOf } from "./preflight";
import { resolvePadronLayouts } from "./resolveLayouts";
import { runPadronWriteTransaction, type PadronWriteOutcome } from "./writeSteps";

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
    }),
    stepTimings,
  };
}

const plannedInputOf = (params: ActualizarPadronParams): PlannedStepsInput => ({
  dryRun: params.dryRun,
  linkAddressMaster: params.options.linkAddressMaster,
});

async function runOnSession(
  session: RunSession,
  params: ActualizarPadronParams,
  deps: RunDeps,
  onProgress?: (progress: RunProgress) => void
): Promise<ActualizarPadronResult> {
  const timer: StepTimer = createStepTimer({
    now: deps.now,
    total: plannedStepLabels(plannedInputOf(params)).length,
    onProgress,
  });
  const layouts: PadronLayouts = await timer.run(STEP.VALIDATE, () => resolvePadronLayouts(session, params));
  const localityWarnings = await timer.run(STEP.TARGET, () => assertTargetReady(session, layouts));
  await timer.run(STEP.COUNT, () => assertSourceTablesReady(session, sourceTablesSpecOf(layouts)));
  const outcome = await runPadronWriteTransaction(session, params, layouts, timer);
  return buildResult(params, outcome, timer.timings, localityWarnings);
}

function assertLinkMatchesAddressMasterTable(params: ActualizarPadronParams): void {
  if (params.options.linkAddressMaster !== (params.addressMasterTable !== undefined)) {
    throw new Error(
      "La opción de enlace de direcciones maestras no coincide con la tabla de direcciones maestras. Active el enlace y elija la tabla, o desactive ambos."
    );
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
  return withRunSession(params.config, deps, (session) => runOnSession(session, params, deps, onProgress));
}
