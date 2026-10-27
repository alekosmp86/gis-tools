import { createStepTimer, type StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunDeps, RunProgress, RunSession } from "../../cargar-padrones/types";
import { openRunSession, scrubbedFailure } from "../../shared/transaction";
import { plannedUnitStepLabels, UNIT_STEP } from "../domain/plannedSteps";
import { assertDistinctUnitTables } from "../domain/tableRoles";
import { buildUnitWarnings } from "../domain/warnings";
import type { UnitParams, UnitResult } from "../types";
import { assertRunAllowed, assertSourcesReady, assertTargetsReady } from "./preflight";
import { resolveUnitLayouts } from "./resolveLayouts";
import { runUnitWriteTransaction, type UnitWriteOutcome } from "./writeSteps";

function buildResult(params: UnitParams, outcome: UnitWriteOutcome, stepTimings: UnitResult["stepTimings"]): UnitResult {
  const { source, target } = outcome;
  return {
    dryRun: params.dryRun,
    targetModified: outcome.targetModified,
    outcomeUnknown: outcome.outcomeUnknown,
    totals: source.totals,
    skipped: { ...source.skippedByReason, samples: source.skippedSamples },
    target,
    warnings: buildUnitWarnings({
      dryRun: params.dryRun,
      options: params.options,
      totals: source.totals,
      target,
      commitError: outcome.commitError,
    }),
    stepTimings,
  };
}

async function runOnSession(
  session: RunSession,
  params: UnitParams,
  deps: RunDeps,
  onProgress?: (progress: RunProgress) => void
): Promise<UnitResult> {
  const timer: StepTimer = createStepTimer({
    now: deps.now,
    total: plannedUnitStepLabels({ dryRun: params.dryRun }).length,
    onProgress,
  });
  const layouts = await timer.run(UNIT_STEP.VALIDATE, () => resolveUnitLayouts(session, params));
  await timer.run(UNIT_STEP.TARGET, () => assertTargetsReady(session, layouts));
  await timer.run(UNIT_STEP.COUNT, () => assertSourcesReady(session, layouts));
  const outcome = await runUnitWriteTransaction(session, params, layouts, timer);
  return buildResult(params, outcome, timer.timings);
}

export async function runUnidadTerritorial(
  params: UnitParams,
  deps: RunDeps,
  onProgress?: (progress: RunProgress) => void
): Promise<UnitResult> {
  assertRunAllowed(params);
  assertDistinctUnitTables(params);
  const session = await openRunSession(params.config, deps);
  try {
    return await runOnSession(session, params, deps, onProgress);
  } catch (error: unknown) {
    throw scrubbedFailure(error, params.config.password);
  } finally {
    await session.close().catch(() => undefined);
  }
}
