import { LONG_STATEMENT_TIMEOUT_MS, SHORT_STATEMENT_TIMEOUT_MS, SUBDIVIDE_BATCH_POINTS, SUBDIVIDE_MAX_VERTICES } from "../constants.ts";
import { EWKB_SRID } from "../reader/types.ts";
import { JOB_STAGE, LOG_LEVEL } from "../types.ts";
import { planRecordBatches } from "./batches.ts";
import { toNumber } from "./pgSession.ts";
import type { PhaseContext } from "./phaseContext.ts";
import { createWorkTableStatement, stageRecordsStatement, subdivideBatchStatement } from "./realQueries.ts";
import { forEachSequential } from "./sequence.ts";
import { throwIfCancelled } from "./stepErrors.ts";

/** Splits the raw geometry into pieces of at most 256 vertices (the proven "split first, repair the pieces" order). */
export async function subdividingPhase(context: PhaseContext): Promise<number> {
  const { job, session } = context;
  const table = job.target.table;
  job.setStage(JOB_STAGE.SUBDIVIDING);
  await session.setStatementTimeout(SHORT_STATEMENT_TIMEOUT_MS);
  await session.rows(createWorkTableStatement(table, EWKB_SRID));
  const records = (await session.rows(stageRecordsStatement(table))).map((row) => ({ rec: toNumber(row.rec), npoints: toNumber(row.npoints) }));
  const batches = planRecordBatches(records, SUBDIVIDE_BATCH_POINTS);
  const totalPoints = batches.reduce((sum, batch) => sum + batch.points, 0);
  await session.setStatementTimeout(LONG_STATEMENT_TIMEOUT_MS);

  let pieces = 0;
  let pointsDone = 0;
  await forEachSequential(batches, async (batch) => {
    throwIfCancelled(job.signal);
    const row = await session.first(subdivideBatchStatement(table, batch.firstRecord, batch.lastRecord, SUBDIVIDE_MAX_VERTICES, EWKB_SRID));
    pieces += toNumber(row.pieces);
    pointsDone += batch.points;
    job.updateProgress({ piecesTotal: pieces, stageFraction: totalPoints > 0 ? pointsDone / totalPoints : 1 });
  });
  job.log(LOG_LEVEL.INFO, `Subdivisión terminada: ${pieces} piezas de hasta ${SUBDIVIDE_MAX_VERTICES} vértices desde ${records.length} registros.`);
  return pieces;
}
