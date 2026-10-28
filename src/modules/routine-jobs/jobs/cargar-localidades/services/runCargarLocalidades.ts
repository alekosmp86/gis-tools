import { createStepTimer, type StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunDeps, RunProgress, RunSession, StepTiming } from "../../cargar-padrones/types";
import { plannedLocalityStepLabels, LOCALITY_STEP } from "../domain/plannedSteps";
import { assertDistinctTables, targetLabelsOf } from "../domain/tableRoles";
import { buildWarnings } from "../domain/warnings";
import type { CargarLocalidadesParams, CargarLocalidadesResult } from "../types";
import { CONFIRM_REQUIRED_MESSAGE, sourceTablesSpecOf, writeTargetsSpecOf } from "./preflight";
import { resolveLocalityLayouts } from "./resolveLayouts";
import { assertConfirmedOrDryRun, assertSourceTablesReady, assertWriteTargetsReady } from "../../shared/preflightAsserts";
import { withRunSession } from "../../shared/transaction";
import { runWriteTransaction, type WriteOutcome } from "./writeSteps";

function buildResult(
  params: CargarLocalidadesParams,
  outcome: WriteOutcome,
  stepTimings: StepTiming[]
): CargarLocalidadesResult {
  const { source, targets } = outcome;
  return {
    dryRun: params.dryRun,
    targetsModified: outcome.targetsModified,
    outcomeUnknown: outcome.outcomeUnknown,
    totals: source.totals,
    skipped: { ...source.skippedByReason, samples: source.skippedSamples },
    targets,
    warnings: buildWarnings({
      dryRun: params.dryRun,
      updateGeometries: params.options.updateGeometries,
      totals: source.totals,
      targets,
      commitError: outcome.commitError,
    }),
    stepTimings,
  };
}

async function runOnSession(
  session: RunSession,
  params: CargarLocalidadesParams,
  deps: RunDeps,
  onProgress?: (progress: RunProgress) => void
): Promise<CargarLocalidadesResult> {
  const timer: StepTimer = createStepTimer({
    now: deps.now,
    total: plannedLocalityStepLabels({ dryRun: params.dryRun, tables: targetLabelsOf(params) }).length,
    onProgress,
  });
  const layouts = await timer.run(LOCALITY_STEP.VALIDATE, () => resolveLocalityLayouts(session, params));
  await timer.run(LOCALITY_STEP.TARGETS, () => assertWriteTargetsReady(session, writeTargetsSpecOf(layouts)));
  await timer.run(LOCALITY_STEP.COUNT, () => assertSourceTablesReady(session, sourceTablesSpecOf(layouts)));
  const outcome = await runWriteTransaction(session, params, layouts, timer);
  return buildResult(params, outcome, timer.timings);
}

export async function runCargarLocalidades(
  params: CargarLocalidadesParams,
  deps: RunDeps,
  onProgress?: (progress: RunProgress) => void
): Promise<CargarLocalidadesResult> {
  assertConfirmedOrDryRun(params, CONFIRM_REQUIRED_MESSAGE);
  assertDistinctTables(params);
  return withRunSession(params.config, deps, (session) => runOnSession(session, params, deps, onProgress));
}
