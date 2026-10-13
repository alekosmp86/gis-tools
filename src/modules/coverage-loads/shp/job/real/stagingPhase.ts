import type { Writable } from "node:stream";
import { iterateRecordEwkb } from "../reader/shpEwkbReader.ts";
import { EWKB_SRID } from "../reader/types.ts";
import type { EwkbRecord } from "../reader/types.ts";
import { JOB_STAGE, LOG_LEVEL } from "../types.ts";
import { binaryCopyHeader, binaryCopyTrailer, stageTupleHeader, writeChunk } from "./binaryCopy.ts";
import { abortCopy, trackCopy } from "./copyTracking.ts";
import { toNumber } from "./pgSession.ts";
import type { PhaseContext } from "./phaseContext.ts";
import {
  copyStageStatement,
  createStageTableStatement,
  dropWorkTablesStatement,
  stageStatsStatement,
} from "./realQueries.ts";
import type { StageMetrics } from "./gates.ts";
import { FAILURE_CODE, JobStepError, throwIfCancelled } from "./stepErrors.ts";
import { LONG_STATEMENT_TIMEOUT_MS, SHORT_STATEMENT_TIMEOUT_MS } from "../constants.ts";
import type { ShpTable } from "../types.ts";

export interface StagedFile {
  readonly recordsRead: number;
  readonly metrics: StageMetrics;
}

async function writeRecord(copy: Writable, record: EwkbRecord, signal: AbortSignal): Promise<void> {
  await writeChunk(copy, stageTupleHeader(record.recordNumber, record.pointCount, record.totalBytes), signal);
  let sent = 0;
  for await (const chunk of record.chunks()) {
    sent += chunk.byteLength;
    await writeChunk(copy, chunk, signal);
  }
  if (sent !== record.totalBytes) {
    throw new JobStepError(FAILURE_CODE.STAGE_MISMATCH, `El registro ${record.recordNumber} produjo ${sent} bytes y se esperaban ${record.totalBytes}.`);
  }
}

async function streamRecords(context: PhaseContext, copy: Writable): Promise<number> {
  const { job } = context;
  let copied = 0;
  await writeChunk(copy, binaryCopyHeader(), job.signal);
  const records = iterateRecordEwkb(job.sourcePath, {
    signal: job.signal,
    onProgress: (bytesRead, bytesTotal) =>
      job.updateProgress({ bytesRead, bytesTotal, stageFraction: bytesTotal > 0 ? Math.min(1, bytesRead / bytesTotal) : 0 }),
  });
  for await (const record of records) {
    throwIfCancelled(job.signal);
    await writeRecord(copy, record, job.signal);
    copied += 1;
    job.updateProgress({ rowsCopied: copied });
  }
  await writeChunk(copy, binaryCopyTrailer(), job.signal);
  return copied;
}

/** Ends the COPY cleanly, or tears it down (CopyFail) so the connection is usable for cleanup. */
async function runCopy(context: PhaseContext, table: ShpTable): Promise<number> {
  const copy = context.session.copyIn(copyStageStatement(table));
  const tracker = trackCopy(copy);
  try {
    const copied = await streamRecords(context, copy);
    copy.end();
    await tracker.finished;
    return copied;
  } catch (error) {
    await abortCopy(copy, tracker, error instanceof Error ? error : new Error("COPY interrumpido."));
    throw tracker.failure() ?? error;
  }
}

async function verifyStage(context: PhaseContext, copied: number): Promise<StageMetrics> {
  const row = await context.session.first(stageStatsStatement(tableOf(context)));
  const metrics = { rows: toNumber(row.rows), area: toNumber(row.area) };
  if (metrics.rows !== copied) {
    throw new JobStepError(FAILURE_CODE.STAGE_MISMATCH, `Se enviaron ${copied} registros pero la tabla de trabajo tiene ${metrics.rows}.`);
  }
  return metrics;
}

function tableOf(context: PhaseContext): ShpTable {
  return context.job.target.table;
}

/** Pass 2: raw geometry (EWKB, SRID in the bytes) into `shp_stage_<table>` through binary COPY. */
export async function stagingPhase(context: PhaseContext): Promise<StagedFile> {
  const { job, session } = context;
  const table = tableOf(context);
  job.setStage(JOB_STAGE.STAGING);
  await session.setStatementTimeout(SHORT_STATEMENT_TIMEOUT_MS);
  await session.rows(dropWorkTablesStatement(table));
  await session.rows(createStageTableStatement(table));
  await session.setStatementTimeout(LONG_STATEMENT_TIMEOUT_MS);
  const copied = await runCopy(context, table);
  job.log(LOG_LEVEL.INFO, `COPY terminado: ${copied} registros en ${context.names.stage} (SRID ${EWKB_SRID}).`);
  await session.setStatementTimeout(SHORT_STATEMENT_TIMEOUT_MS);
  const metrics = await verifyStage(context, copied);
  return { recordsRead: copied, metrics };
}
