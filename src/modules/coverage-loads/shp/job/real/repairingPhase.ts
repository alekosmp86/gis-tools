import { LONG_STATEMENT_TIMEOUT_MS, REPAIR_BATCH_PIECES, SHORT_STATEMENT_TIMEOUT_MS } from "../constants.ts";
import { JOB_STAGE, LOG_LEVEL } from "../types.ts";
import type { JobGates } from "../types.ts";
import { planPieceRanges } from "./batches.ts";
import { evaluateGates } from "./gates.ts";
import type { StageMetrics, WorkMetrics } from "./gates.ts";
import { toNumber } from "./pgSession.ts";
import type { PhaseContext } from "./phaseContext.ts";
import { deleteEmptyPiecesStatement, pieceRangeStatement, repairBatchStatement, workStatsStatement } from "./realQueries.ts";
import { forEachSequential } from "./sequence.ts";
import { GateFailedError, throwIfCancelled } from "./stepErrors.ts";

export interface RepairInput {
  readonly recordsRead: number;
  readonly stage: StageMetrics;
  readonly fileArea: number;
}

export interface RepairResult {
  readonly gates: JobGates;
  readonly work: WorkMetrics;
}

async function repairPieces(context: PhaseContext): Promise<void> {
  const { job, session } = context;
  const table = job.target.table;
  const range = await session.first(pieceRangeStatement(table));
  const total = toNumber(range.pieces);
  const batches = planPieceRanges(toNumber(range.first_id), toNumber(range.last_id), REPAIR_BATCH_PIECES);
  let repaired = 0;
  job.updateProgress({ piecesTotal: total, piecesRepaired: 0 });
  await forEachSequential(batches, async (batch) => {
    throwIfCancelled(job.signal);
    const row = await session.first(repairBatchStatement(table, batch.firstId, batch.lastId));
    repaired += toNumber(row.repaired);
    job.updateProgress({ piecesRepaired: repaired, stageFraction: total > 0 ? Math.min(1, repaired / total) : 1 });
  });
}

async function readWorkMetrics(context: PhaseContext): Promise<WorkMetrics> {
  const row = await context.session.first(workStatsStatement(context.job.target.table));
  return {
    pieces: toNumber(row.pieces),
    maxVertices: toNumber(row.max_vertices),
    invalidPieces: toNumber(row.invalid_pieces),
    vertices: toNumber(row.vertices),
    area: toNumber(row.area),
  };
}

/** Repairs every piece, drops the ones that came out empty, then applies the gates before anything can be swapped. */
export async function repairingPhase(context: PhaseContext, input: RepairInput): Promise<RepairResult> {
  const { job, session } = context;
  job.setStage(JOB_STAGE.REPAIRING);
  await session.setStatementTimeout(LONG_STATEMENT_TIMEOUT_MS);
  await repairPieces(context);
  const removed = toNumber((await session.first(deleteEmptyPiecesStatement(job.target.table))).removed);
  if (removed > 0) job.log(LOG_LEVEL.WARN, `${removed} piezas quedaron vacías tras la reparación y se descartaron.`);
  const work = await readWorkMetrics(context);
  job.updateProgress({ piecesTotal: work.pieces, piecesRepaired: work.pieces, stageFraction: 1 });
  await session.setStatementTimeout(SHORT_STATEMENT_TIMEOUT_MS);
  const verdict = evaluateGates({ recordsRead: input.recordsRead, stage: input.stage, work, fileArea: input.fileArea });
  job.log(LOG_LEVEL.INFO, `Verificaciones: ${JSON.stringify(verdict.gates)}.`);
  if (!verdict.gates.passed) throw new GateFailedError(verdict.gates, verdict.reasons);
  return { gates: verdict.gates, work };
}
