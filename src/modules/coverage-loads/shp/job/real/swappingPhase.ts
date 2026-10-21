import { LONG_STATEMENT_TIMEOUT_MS, LOAD_SOURCE, SWAP_LOCK_TIMEOUT_MS } from "../constants.ts";
import { JOB_STAGE, LOG_LEVEL } from "../types.ts";
import { toNumber } from "./pgSession.ts";
import type { PhaseContext } from "./phaseContext.ts";
import {
  countTargetStatement,
  deleteTargetStatement,
  insertTargetStatement,
  lockTargetStatement,
  setConfigStatement,
} from "./realQueries.ts";
import { FAILURE_CODE, JobStepError, throwIfCancelled } from "./stepErrors.ts";

/**
 * REPLACE semantics in ONE transaction: LOCK (SHARE ROW EXCLUSIVE, readers keep reading) + DELETE + INSERT of every piece. Any failure, a cancel or a
 * row-count mismatch rolls back and leaves the previous data untouched.
 */
export async function swappingPhase(context: PhaseContext, expectedRows: number): Promise<void> {
  const { job, session } = context;
  const table = job.target.table;
  job.setStage(JOB_STAGE.SWAPPING);
  throwIfCancelled(job.signal);
  await session.setStatementTimeout(LONG_STATEMENT_TIMEOUT_MS);
  await session.transaction(async () => {
    await session.rows(setConfigStatement("lock_timeout", String(SWAP_LOCK_TIMEOUT_MS), true));
    await session.rows(lockTargetStatement(table));
    await session.rows(deleteTargetStatement(table));
    await session.rows(insertTargetStatement(table, job.target.fechaact, LOAD_SOURCE));
    const loaded = toNumber((await session.first(countTargetStatement(table))).rows);
    if (loaded !== expectedRows) {
      throw new JobStepError(FAILURE_CODE.SWAP_MISMATCH, `La tabla quedó con ${loaded} filas y se esperaban ${expectedRows}; se revirtió el reemplazo.`);
    }
    throwIfCancelled(job.signal);
  });
  job.updateProgress({ stageFraction: 1 });
  job.log(LOG_LEVEL.INFO, `Reemplazo confirmado: ${expectedRows} filas en ${context.names.target}.`);
}
