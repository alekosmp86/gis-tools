import { CLEANUP_RETRIES, LONG_STATEMENT_TIMEOUT_MS } from "../constants.ts";
import { JOB_MODE, JOB_STAGE, LOG_LEVEL } from "../types.ts";
import type { TableMetrics, TestReport } from "../types.ts";
import { errorText } from "../scrub.ts";
import { buildTestReport } from "./gates.ts";
import type { WorkMetrics } from "./gates.ts";
import { toNumber } from "./pgSession.ts";
import type { PhaseContext } from "./phaseContext.ts";
import { analyzeTargetStatement, dropWorkTablesStatement, targetStatsStatement } from "./realQueries.ts";

export interface FinalizeResult {
  readonly testReport?: TestReport;
  readonly leftovers: string[];
}

function metricsOf(work: WorkMetrics): TableMetrics {
  return { rows: work.pieces, vertices: work.vertices, area: work.area };
}

async function readTargetMetrics(context: PhaseContext): Promise<TableMetrics> {
  const row = await context.session.first(targetStatsStatement(context.job.target.table));
  return { rows: toNumber(row.pieces), vertices: toNumber(row.vertices), area: toNumber(row.area) };
}

async function analyzeTarget(context: PhaseContext): Promise<void> {
  try {
    await context.session.rows(analyzeTargetStatement(context.job.target.table));
  } catch (error) {
    context.job.log(LOG_LEVEL.WARN, `ANALYZE falló (la carga ya estaba confirmada): ${errorText(error, "error desconocido")}`);
  }
}

async function tryDrop(context: PhaseContext, attempt: number): Promise<boolean> {
  try {
    await context.session.rows(dropWorkTablesStatement(context.job.target.table));
    return true;
  } catch (error) {
    context.job.log(LOG_LEVEL.WARN, `No se pudieron borrar las tablas de trabajo (intento ${attempt}): ${errorText(error, "error desconocido")}`);
    return false;
  }
}

/**
 * Drops `shp_stage_<table>` and `shp_work_<table>`. Retries because a late `pg_cancel_backend` can hit
 * the drop itself. Returns the work tables that are still there (never throws).
 */
export async function dropWorkTables(context: PhaseContext): Promise<string[]> {
  const attempts = Array.from({ length: CLEANUP_RETRIES }, (_, index) => index + 1);
  const dropped = await attempts.reduce<Promise<boolean>>(
    (previous, attempt) => previous.then((done) => (done ? true : tryDrop(context, attempt))),
    Promise.resolve(false)
  );
  return dropped ? [] : [context.names.stage, context.names.work];
}

/** LOAD: refresh statistics. TEST: compare the target with the pieces. Both end by dropping the work tables. */
export async function finalizingPhase(context: PhaseContext, work: WorkMetrics): Promise<FinalizeResult> {
  const { job, session } = context;
  job.setStage(JOB_STAGE.FINALIZING);
  await session.setStatementTimeout(LONG_STATEMENT_TIMEOUT_MS);
  const testReport = job.mode === JOB_MODE.TEST ? buildTestReport(await readTargetMetrics(context), metricsOf(work)) : undefined;
  if (job.mode === JOB_MODE.LOAD) await analyzeTarget(context);
  const leftovers = await dropWorkTables(context);
  job.updateProgress({ stageFraction: 1 });
  return testReport === undefined ? { leftovers } : { testReport, leftovers };
}
