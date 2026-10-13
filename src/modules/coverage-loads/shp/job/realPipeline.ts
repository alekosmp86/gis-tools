import type { JobPgClientFactory } from "./pg/createClient.ts";
import type { JobContext, JobPipeline, PipelineOutcome } from "./pipeline.ts";
import { errorText } from "./scrub.ts";
import { JOB_MODE, LOG_LEVEL } from "./types.ts";
import type { JobGates } from "./types.ts";
import { dropWorkTables, finalizingPhase } from "./real/finalizingPhase.ts";
import { openPgSession } from "./real/pgSession.ts";
import type { CopyInFactory, PgSession } from "./real/pgSession.ts";
import type { PhaseContext } from "./real/phaseContext.ts";
import { readingPhase } from "./real/readingPhase.ts";
import { ROLLBACK_STATEMENT, advisoryUnlockStatement, tableIdentifiers, tryAdvisoryLockStatement } from "./real/realQueries.ts";
import { repairingPhase } from "./real/repairingPhase.ts";
import { stagingPhase } from "./real/stagingPhase.ts";
import { FAILURE_CODE, JobStepError, outcomeFromError, throwIfCancelled } from "./real/stepErrors.ts";
import { subdividingPhase } from "./real/subdividingPhase.ts";
import { swappingPhase } from "./real/swappingPhase.ts";

export interface RealPipelineDeps {
  /** Replaces the `pg.Client` factory (tests). */
  clientFactory?: JobPgClientFactory;
  /** Replaces the `pg-copy-streams` COPY FROM stream (tests). */
  copyIn?: CopyInFactory;
}

interface RunState {
  gates: JobGates | null;
  locked: boolean;
  swapped: boolean;
  leftovers: string[] | null;
}

async function takeAdvisoryLock(context: PhaseContext, state: RunState): Promise<void> {
  const row = await context.session.first(tryAdvisoryLockStatement(context.job.target.table));
  if (row.locked !== true) {
    throw new JobStepError(FAILURE_CODE.TABLE_LOCKED, `Otra carga de la tabla ${context.job.target.table} está en curso en la base de datos.`);
  }
  state.locked = true;
}

/** Cancel = `pg_cancel_backend` on the work connection, sent from a second short connection. */
function registerCancelHook(context: PhaseContext): void {
  const { job, session } = context;
  job.registerOnCancel(async () => {
    const cancelled = await session.cancelRunning(job.connection);
    job.log(LOG_LEVEL.WARN, cancelled ? "Sentencia en curso cancelada en el servidor." : "No había una sentencia en curso que cancelar.");
  });
}

async function runPhases(context: PhaseContext, state: RunState): Promise<PipelineOutcome> {
  const { job } = context;
  const scan = await readingPhase(job);
  throwIfCancelled(job.signal);
  const staged = await stagingPhase(context);
  throwIfCancelled(job.signal);
  await subdividingPhase(context);
  throwIfCancelled(job.signal);
  const repaired = await repairingPhase(context, { recordsRead: staged.recordsRead, stage: staged.metrics, fileArea: scan.netArea });
  state.gates = repaired.gates;
  throwIfCancelled(job.signal);
  if (job.mode === JOB_MODE.LOAD) {
    await swappingPhase(context, repaired.work.pieces);
    state.swapped = true;
  }
  const finalized = await finalizingPhase(context, repaired.work);
  state.leftovers = finalized.leftovers;
  return finalized.testReport === undefined
    ? { kind: "SUCCEEDED", gates: repaired.gates, leftovers: finalized.leftovers }
    : { kind: "SUCCEEDED", gates: repaired.gates, testReport: finalized.testReport, leftovers: finalized.leftovers };
}

/** After the swap committed the load is a success: trouble in the housekeeping only leaves work tables behind. */
function outcomeAfterFailure(context: PhaseContext, state: RunState, error: unknown): PipelineOutcome {
  if (state.swapped && state.gates !== null) {
    context.job.log(LOG_LEVEL.WARN, `Error tras confirmar el reemplazo: ${errorText(error, "error desconocido")}`);
    return { kind: "SUCCEEDED", gates: state.gates, leftovers: [context.names.stage, context.names.work] };
  }
  return outcomeFromError(error, context.job.signal);
}

/** Only the holder of the advisory lock may drop the work tables: they could belong to a live run otherwise. */
async function cleanUp(context: PhaseContext, state: RunState): Promise<void> {
  if (!state.locked || state.leftovers !== null) return;
  await context.session.rows(ROLLBACK_STATEMENT).catch(() => undefined);
  const remaining = await dropWorkTables(context);
  if (remaining.length > 0) context.job.log(LOG_LEVEL.WARN, `Quedaron tablas de trabajo sin borrar: ${remaining.join(", ")}.`);
}

async function runLocked(context: PhaseContext): Promise<PipelineOutcome> {
  const state: RunState = { gates: null, locked: false, swapped: false, leftovers: null };
  try {
    await takeAdvisoryLock(context, state);
    registerCancelHook(context);
    return await runPhases(context, state);
  } catch (error) {
    const outcome = outcomeAfterFailure(context, state, error);
    await cleanUp(context, state);
    return outcome;
  } finally {
    context.job.registerOnCancel(null);
    if (state.locked) await context.session.rows(advisoryUnlockStatement(context.job.target.table)).catch(() => undefined);
  }
}

async function runConnected(job: JobContext, deps: RealPipelineDeps): Promise<PipelineOutcome> {
  let session: PgSession;
  try {
    session = await openPgSession(job.connection, job.log, deps);
  } catch (error) {
    return outcomeFromError(new JobStepError(FAILURE_CODE.DB_CONNECT, `No se pudo conectar a la base de datos: ${errorText(error, "error de conexión")}`), job.signal);
  }
  try {
    return await runLocked({ job, session, names: tableIdentifiers(job.target.table) });
  } finally {
    await session.close();
  }
}

/**
 * The real loader: READING (scan) -> STAGING (binary COPY into `shp_stage_<table>`) -> SUBDIVIDING ->
 * REPAIRING (+ gates) -> SWAPPING (LOAD only, one transaction) -> FINALIZING. It holds the table's
 * advisory lock for the whole run and always tries to drop its work tables.
 */
export function createRealPipeline(deps: RealPipelineDeps = {}): JobPipeline {
  return { run: (job) => runConnected(job, deps) };
}
