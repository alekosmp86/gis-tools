import { AnalyzeStatus } from "@/core/types/replace";
import { CLEAR_MODE } from "../../cargar-padrones/constants";
import { createStepTimer, type StepTimer } from "../../cargar-padrones/services/runSteps";
import { plannedStepLabels, STEP } from "../domain/plannedSteps";
import { buildRunWarnings } from "../domain/warnings";
import type {
  ActualizarPadronParams,
  ActualizarPadronResult,
  RunDeps,
  RunProgress,
  RunSession,
  StepTiming,
} from "../types";
import {
  assertRunAllowed,
  assertStagingHasRows,
  assertStagingSridSupported,
  assertTruncatable,
  assertUnitTypeUnique,
  assertWorkTableSafe,
  assertWorkWritePrivileges,
} from "./preflight";
import { assertDistinctTables, resolveActualizarLayouts, type ResolvedActualizarLayouts } from "./resolveLayouts";
import { runWriteTransaction, scrubSecret, type LoadOutcome } from "./writeSteps";

const COMMIT_SQL = "COMMIT";
const ROLLBACK_SQL = "ROLLBACK";

const errorMessageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function openRunSession(params: ActualizarPadronParams, deps: RunDeps): Promise<RunSession> {
  try {
    return await deps.openSession(params.config);
  } catch (error: unknown) {
    throw new Error(scrubSecret(`No se pudo abrir la conexión: ${errorMessageOf(error)}`, params.config.password));
  }
}

async function validateLayouts(session: RunSession, params: ActualizarPadronParams): Promise<ResolvedActualizarLayouts> {
  const layouts = await resolveActualizarLayouts(session, params);
  assertWorkTableSafe(layouts);
  await assertWorkWritePrivileges(session, layouts.work);
  await assertUnitTypeUnique(session, layouts.unitType);
  return layouts;
}

async function countStagingRows(session: RunSession, layouts: ResolvedActualizarLayouts): Promise<void> {
  await assertStagingHasRows(session, layouts.staging);
  await assertStagingSridSupported(session, layouts.staging, layouts.work.srid);
}

async function commitTransaction(session: RunSession, secret: string | undefined): Promise<string | undefined> {
  try {
    await session.query(COMMIT_SQL);
    return undefined;
  } catch (error: unknown) {
    return scrubSecret(errorMessageOf(error), secret);
  }
}

async function finishTransaction(
  session: RunSession,
  params: ActualizarPadronParams,
  timer: StepTimer
): Promise<string | undefined> {
  if (params.dryRun) {
    await timer.run(STEP.ROLLBACK, () => session.query(ROLLBACK_SQL));
    return undefined;
  }
  return timer.run(STEP.COMMIT, () => commitTransaction(session, params.config.password));
}

function buildResult(
  params: ActualizarPadronParams,
  loaded: LoadOutcome,
  commitError: string | undefined,
  timings: StepTiming[]
): ActualizarPadronResult {
  const { rowsRead, repaired, skipped } = loaded.report.totals;
  const totals = {
    rowsRead,
    accepted: rowsRead - skipped,
    written: loaded.written,
    repaired,
    skipped,
  };
  return {
    dryRun: params.dryRun,
    tempModified: !params.dryRun && commitError === undefined,
    padronModified: false,
    outcomeUnknown: commitError !== undefined,
    totals,
    skipped: loaded.report.skipped,
    warnings: buildRunWarnings({
      dryRun: params.dryRun,
      totals,
      collidingKeyCount: loaded.report.skipped.collidingKeyCount,
      commitError,
    }),
    stepTimings: timings,
    analyze: { status: AnalyzeStatus.OK },
  };
}

async function runOnSession(
  session: RunSession,
  params: ActualizarPadronParams,
  deps: RunDeps,
  onProgress?: (progress: RunProgress) => void
): Promise<ActualizarPadronResult> {
  const { clearMode } = params.options;
  const timer = createStepTimer({
    now: deps.now,
    total: plannedStepLabels({ dryRun: params.dryRun, clearMode }).length,
    onProgress,
  });
  const layouts = await timer.run(STEP.VALIDATE, () => validateLayouts(session, params));
  await timer.run(STEP.COUNT, () => countStagingRows(session, layouts));
  if (clearMode === CLEAR_MODE.TRUNCATE) {
    await timer.run(STEP.PRIVILEGES, () => assertTruncatable(session, layouts.work));
  }
  const loaded = await runWriteTransaction(session, clearMode, layouts, timer, params.config.password);
  // Ordered: COMMIT or ROLLBACK only after the load and the report of the same transaction.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const commitError = await finishTransaction(session, params, timer);
  return buildResult(params, loaded, commitError, timer.timings);
}

function scrubbedFailure(error: unknown, secret: string | undefined): unknown {
  if (!(error instanceof Error) || !secret || !error.message.includes(secret)) return error;
  return new Error(scrubSecret(error.message, secret));
}

export async function runActualizarPadron(
  params: ActualizarPadronParams,
  deps: RunDeps,
  onProgress?: (progress: RunProgress) => void
): Promise<ActualizarPadronResult> {
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
