import { buildAnalyzeStatement } from "@/core/services/sqlStatements";
import { AnalyzeStatus, type AnalyzeOutcome } from "@/core/types/replace";
import { CLEAR_MODE, PADRON_UNIT } from "../constants";
import { buildClearSql, buildLoadSql, type LoadOptions } from "../domain/loadSql";
import { buildWarnings, sentence } from "../domain/warnings";
import type {
  CargarPadronesParams,
  CargarPadronesResult,
  LoadOutput,
  LoadTotals,
  RunDeps,
  RunSession,
  StepTiming,
  TypeReport,
} from "../types";
import { assertTruncatable, assertRunAllowed, assertSourcesHaveRows } from "./preflight";
import { readLoadOutput, type InsertedCounts } from "./readReports";
import { assertDistinctTables, resolveLayouts, type ResolvedLayouts } from "./resolveLayouts";
import {
  repairUnmappedSequences,
  repairUnmappedSequencesAfterRollback,
  resetUnmappedSequences,
} from "./sequences";

export type { CargarPadronesParams, CargarPadronesResult, RunDeps, RunSession } from "../types";

interface WriteOutcome {
  targetModified: boolean;
  outcomeUnknown: boolean;
  commitError?: string;
  analyze: AnalyzeOutcome;
}

interface LoadProgress {
  sequencesTouched: boolean;
}

interface StepTimer {
  timings: StepTiming[];
  run<T>(label: string, work: () => Promise<T>): Promise<T>;
}

const STEP = {
  VALIDATE: "Validación de tablas",
  COUNT: "Conteo de filas",
  PRIVILEGES: "Privilegios de vaciado",
  CLEAR: "Vaciado de la tabla destino",
  SEQUENCES_RESET: "Reinicio de secuencias",
  LOAD_RURAL: "Carga rural",
  LOAD_URBANO: "Carga urbana",
  REPORT: "Reportes y muestras",
  SEQUENCES_REPAIR: "Ajuste de secuencias",
  COMMIT: "COMMIT",
  ANALYZE: "ANALYZE",
} as const;

const BEGIN_SQL = "BEGIN";
const COMMIT_SQL = "COMMIT";
const ROLLBACK_SQL = "ROLLBACK";
const REDACTED = "***";
const SKIPPED_ANALYZE: AnalyzeOutcome = { status: AnalyzeStatus.SKIPPED };

const errorMessageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const scrub = (message: string, password: string | undefined): string =>
  password ? message.split(password).join(REDACTED) : message;

const sumOf = (reports: TypeReport[], pick: (report: TypeReport) => number): number =>
  reports.reduce((total, report) => total + pick(report), 0);

function createStepTimer(now: () => number): StepTimer {
  const timings: StepTiming[] = [];
  return {
    timings,
    async run<T>(label: string, work: () => Promise<T>): Promise<T> {
      const started = now();
      const value = await work();
      timings.push({ label, ms: now() - started });
      return value;
    },
  };
}

async function openRunSession(params: CargarPadronesParams, deps: RunDeps): Promise<RunSession> {
  try {
    return await deps.openSession(params.config);
  } catch (error: unknown) {
    throw new Error(scrub(`No se pudo abrir la conexión: ${errorMessageOf(error)}`, params.config.password));
  }
}

async function insertRows(session: RunSession, sql: string): Promise<number> {
  const result = await session.query(sql);
  return result.rowCount ?? 0;
}

async function insertAll(
  session: RunSession,
  layouts: ResolvedLayouts,
  options: LoadOptions,
  timer: StepTimer
): Promise<InsertedCounts> {
  const rural = await timer.run(STEP.LOAD_RURAL, () =>
    insertRows(session, buildLoadSql(PADRON_UNIT.RURAL, layouts.rural, layouts.target, options))
  );
  // Ordered inserts on one transactional connection: the urban load must run after the rural one.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const urbano = await timer.run(STEP.LOAD_URBANO, () =>
    insertRows(session, buildLoadSql(PADRON_UNIT.URBANO, layouts.urbano, layouts.target, options))
  );
  return { rural, urbano };
}

function assertInsertsMatchGroups(inserted: InsertedCounts, loaded: LoadOutput): void {
  const mismatches = [
    { name: "rural", inserted: inserted.rural, groups: loaded.rural.groups },
    { name: "urbana", inserted: inserted.urbano, groups: loaded.urbano.groups },
  ].filter((entry) => entry.inserted !== entry.groups);
  if (mismatches.length === 0) return;
  const details = mismatches
    .map((entry) => `la carga ${entry.name} insertó ${entry.inserted} filas y se esperaban ${entry.groups} (uno por grupo)`)
    .join("; ");
  throw new Error(`Las filas insertadas no coinciden con los grupos: ${details}.`);
}

async function loadAll(
  session: RunSession,
  params: CargarPadronesParams,
  layouts: ResolvedLayouts,
  timer: StepTimer,
  progress: LoadProgress
): Promise<LoadOutput> {
  const { options, dryRun } = params;
  const useSequences = options.resetSequences && !dryRun;
  await timer.run(STEP.CLEAR, () => session.query(buildClearSql(layouts.target, options.clearMode)));
  if (useSequences) {
    progress.sequencesTouched = true;
    await timer.run(STEP.SEQUENCES_RESET, () => resetUnmappedSequences(session, layouts));
  }
  const inserted = await insertAll(session, layouts, options, timer);
  const loaded = await timer.run(STEP.REPORT, () => readLoadOutput(session, layouts, options, inserted));
  assertInsertsMatchGroups(inserted, loaded);
  if (useSequences) {
    await timer.run(STEP.SEQUENCES_REPAIR, () => repairUnmappedSequences(session, layouts));
  }
  return loaded;
}

async function rollbackQuietly(session: RunSession): Promise<void> {
  await session.query(ROLLBACK_SQL).catch(() => undefined);
}

async function runLoadTransaction(
  session: RunSession,
  params: CargarPadronesParams,
  layouts: ResolvedLayouts,
  timer: StepTimer,
  progress: LoadProgress
): Promise<LoadOutput> {
  try {
    await session.query(BEGIN_SQL);
    return await loadAll(session, params, layouts, timer, progress);
  } catch (error: unknown) {
    await rollbackQuietly(session);
    if (progress.sequencesTouched) {
      await repairUnmappedSequencesAfterRollback(session, layouts);
    }
    const reason = sentence(scrub(errorMessageOf(error), params.config.password));
    throw new Error(`No se pudo completar la carga: ${reason} La tabla destino no fue modificada.`);
  }
}

async function commitTransaction(session: RunSession, password: string | undefined): Promise<string | undefined> {
  try {
    await session.query(COMMIT_SQL);
    return undefined;
  } catch (error: unknown) {
    return scrub(errorMessageOf(error), password);
  }
}

async function analyzeTarget(session: RunSession, params: CargarPadronesParams): Promise<AnalyzeOutcome> {
  try {
    await session.query(buildAnalyzeStatement(params.schema, params.targetTable));
    return { status: AnalyzeStatus.OK };
  } catch (error: unknown) {
    return { status: AnalyzeStatus.FAILED, message: scrub(errorMessageOf(error), params.config.password) };
  }
}

async function writeTransaction(
  session: RunSession,
  params: CargarPadronesParams,
  layouts: ResolvedLayouts,
  timer: StepTimer
): Promise<{ loaded: LoadOutput; outcome: WriteOutcome }> {
  const progress: LoadProgress = { sequencesTouched: false };
  const loaded = await runLoadTransaction(session, params, layouts, timer, progress);
  if (params.dryRun) {
    await session.query(ROLLBACK_SQL);
    return { loaded, outcome: { targetModified: false, outcomeUnknown: false, analyze: SKIPPED_ANALYZE } };
  }
  const commitError = await timer.run(STEP.COMMIT, () => commitTransaction(session, params.config.password));
  if (commitError !== undefined) {
    if (progress.sequencesTouched) {
      await rollbackQuietly(session);
      await repairUnmappedSequencesAfterRollback(session, layouts);
    }
    return {
      loaded,
      outcome: { targetModified: false, outcomeUnknown: true, commitError, analyze: SKIPPED_ANALYZE },
    };
  }
  const analyze = await timer.run(STEP.ANALYZE, () => analyzeTarget(session, params));
  return { loaded, outcome: { targetModified: true, outcomeUnknown: false, analyze } };
}

function buildTotals(reports: TypeReport[]): LoadTotals {
  return {
    rowsRead: sumOf(reports, (report) => report.rowsRead),
    groups: sumOf(reports, (report) => report.groups),
    rowsMerged: sumOf(reports, (report) => report.rowsMerged),
    inserted: sumOf(reports, (report) => report.inserted),
  };
}

function buildResult(
  params: CargarPadronesParams,
  loaded: LoadOutput,
  outcome: WriteOutcome,
  timings: StepTiming[]
): CargarPadronesResult {
  return {
    dryRun: params.dryRun,
    targetModified: outcome.targetModified,
    outcomeUnknown: outcome.outcomeUnknown,
    report: { rural: loaded.rural, urbano: loaded.urbano },
    totals: buildTotals([loaded.rural, loaded.urbano]),
    ambiguousLocalityCodes: loaded.ambiguousLocalityCodes,
    warnings: buildWarnings(loaded, params.options.repair, outcome.commitError),
    stepTimings: timings,
    analyze: outcome.analyze,
  };
}

async function runOnSession(
  session: RunSession,
  params: CargarPadronesParams,
  deps: RunDeps
): Promise<CargarPadronesResult> {
  const timer = createStepTimer(deps.now);
  const layouts = await timer.run(STEP.VALIDATE, () => resolveLayouts(session, params));
  await timer.run(STEP.COUNT, () => assertSourcesHaveRows(session, layouts));
  if (params.options.clearMode === CLEAR_MODE.TRUNCATE) {
    await timer.run(STEP.PRIVILEGES, () => assertTruncatable(session, layouts.target));
  }
  const { loaded, outcome } = await writeTransaction(session, params, layouts, timer);
  return buildResult(params, loaded, outcome, timer.timings);
}

function scrubbedFailure(error: unknown, password: string | undefined): unknown {
  if (!(error instanceof Error) || !password || !error.message.includes(password)) return error;
  return new Error(scrub(error.message, password));
}

export async function runCargarPadrones(params: CargarPadronesParams, deps: RunDeps): Promise<CargarPadronesResult> {
  assertRunAllowed(params);
  assertDistinctTables(params);
  const session = await openRunSession(params, deps);
  try {
    return await runOnSession(session, params, deps);
  } catch (error: unknown) {
    throw scrubbedFailure(error, params.config.password);
  } finally {
    await session.close().catch(() => undefined);
  }
}
