import { createStepTimer, type StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunDeps, RunProgress, RunSession, StepTiming } from "../../cargar-padrones/types";
import { plannedLocalityStepLabels, LOCALITY_STEP } from "../domain/plannedSteps";
import { assertDistinctTables, targetLabelsOf } from "../domain/tableRoles";
import { buildWarnings } from "../domain/warnings";
import type { CargarLocalidadesParams, CargarLocalidadesResult } from "../types";
import { assertRunAllowed, assertSourcesReady, assertTargetsReady } from "./preflight";
import { resolveLocalityLayouts } from "./resolveLayouts";
import { scrubSecret, runWriteTransaction, type WriteOutcome } from "./writeSteps";

const errorMessageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function openRunSession(params: CargarLocalidadesParams, deps: RunDeps): Promise<RunSession> {
  try {
    return await deps.openSession(params.config);
  } catch (error: unknown) {
    throw new Error(scrubSecret(`No se pudo abrir la conexión: ${errorMessageOf(error)}`, params.config.password));
  }
}

function scrubbedFailure(error: unknown, secret: string | undefined): unknown {
  if (!(error instanceof Error) || !secret || !error.message.includes(secret)) return error;
  return new Error(scrubSecret(error.message, secret));
}

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
  await timer.run(LOCALITY_STEP.TARGETS, () => assertTargetsReady(session, layouts));
  await timer.run(LOCALITY_STEP.COUNT, () => assertSourcesReady(session, layouts));
  const outcome = await runWriteTransaction(session, params, layouts, timer);
  return buildResult(params, outcome, timer.timings);
}

export async function runCargarLocalidades(
  params: CargarLocalidadesParams,
  deps: RunDeps,
  onProgress?: (progress: RunProgress) => void
): Promise<CargarLocalidadesResult> {
  assertRunAllowed(params);
  assertDistinctTables(params);
  const session = await openRunSession(params, deps);
  try {
    return await runOnSession(session, params, deps, onProgress);
  } catch (error: unknown) {
    throw scrubbedFailure(error, params.config.password);
  } finally {
    await session.close().catch(() => undefined);
  }
}
