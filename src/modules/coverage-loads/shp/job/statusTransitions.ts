import { EXPECTED_MS_BY_TABLE } from "./constants.ts";
import { JOB_STAGE, JOB_STATE, SCHEMA_VERSION, STAGE_STATE } from "./types.ts";
import type { JobMode, JobProgress, JobStageId, JobStatus, JobTarget, StageEntry, ShpPrefix, ShpTable } from "./types.ts";
import type { PipelineOutcome } from "./pipeline.ts";

/** Pure-ish helpers: they mutate the `JobStatus` they are handed and nothing else. */

const STAGE_ORDER: readonly JobStageId[] = [
  JOB_STAGE.COPYING_FILE,
  JOB_STAGE.READING,
  JOB_STAGE.STAGING,
  JOB_STAGE.SUBDIVIDING,
  JOB_STAGE.REPAIRING,
  JOB_STAGE.SWAPPING,
  JOB_STAGE.FINALIZING,
];

export const CRASH_ERROR = {
  code: "JOB_CRASHED",
  message: "El proceso de carga terminó de forma inesperada.",
} as const;

function pendingStage(id: JobStageId): StageEntry {
  return { id, state: STAGE_STATE.PENDING, startedAt: null, endedAt: null, durationMs: null };
}

export function emptyProgress(bytesTotal: number): JobProgress {
  return {
    bytesRead: 0,
    bytesTotal,
    rowsCopied: 0,
    piecesTotal: 0,
    piecesRepaired: 0,
    stageFraction: 0,
    overallFraction: 0,
  };
}

export interface InitialStatusInput {
  jobId: string;
  mode: JobMode;
  table: ShpTable;
  prefix: ShpPrefix;
  fechaact: string;
  fileName: string;
  sizeBytes: number;
  receivedBytes: number;
  now: number;
  state?: JobStatus["state"];
}

export function createInitialStatus(input: InitialStatusInput): JobStatus {
  const target: JobTarget = { table: input.table, prefix: input.prefix, fechaact: input.fechaact };
  const iso = new Date(input.now).toISOString();
  const state = input.state ?? JOB_STATE.UPLOADING;
  const copyingDone = state !== JOB_STATE.UPLOADING;
  const stages = STAGE_ORDER.map(pendingStage);
  stages[0] = copyingDone
    ? { id: JOB_STAGE.COPYING_FILE, state: STAGE_STATE.DONE, startedAt: iso, endedAt: iso, durationMs: 0 }
    : { ...stages[0], state: STAGE_STATE.RUNNING, startedAt: iso };
  return {
    schemaVersion: SCHEMA_VERSION,
    jobId: input.jobId,
    mode: input.mode,
    target,
    source: { fileName: input.fileName, sizeBytes: input.sizeBytes, receivedBytes: input.receivedBytes },
    state,
    stage: copyingDone ? null : JOB_STAGE.COPYING_FILE,
    stages,
    progress: emptyProgress(input.sizeBytes),
    expectedMs: EXPECTED_MS_BY_TABLE[input.table],
    startedAt: null,
    updatedAt: iso,
    heartbeatAt: null,
    pid: null,
    nodeVersion: null,
    gates: null,
    testReport: null,
    leftovers: [],
    cancelRequested: false,
    error: null,
  };
}

/** Equal weights over the stages that are not skipped; Phase 3 may refine with real timings. */
export function computeOverallFraction(stages: readonly StageEntry[], stageFraction: number): number {
  const counted = stages.filter((stage) => stage.state !== STAGE_STATE.SKIPPED);
  if (counted.length === 0) return 0;
  const done = counted.filter((stage) => stage.state === STAGE_STATE.DONE).length;
  return Math.min(1, (done + stageFraction) / counted.length);
}

function closeRunningStage(status: JobStatus, closeAs: StageEntry["state"], nowMs: number): void {
  const running = status.stages.find((stage) => stage.state === STAGE_STATE.RUNNING);
  if (!running) return;
  running.state = closeAs;
  running.endedAt = new Date(nowMs).toISOString();
  running.durationMs = running.startedAt ? Math.max(0, nowMs - Date.parse(running.startedAt)) : null;
}

/** Closes the running stage as done and opens `id`. */
export function startStage(status: JobStatus, id: JobStageId, nowMs: number): void {
  closeRunningStage(status, STAGE_STATE.DONE, nowMs);
  const entry = status.stages.find((stage) => stage.id === id);
  if (entry) {
    entry.state = STAGE_STATE.RUNNING;
    entry.startedAt = new Date(nowMs).toISOString();
    entry.endedAt = null;
    entry.durationMs = null;
  }
  status.stage = id;
  status.progress.stageFraction = 0;
  status.progress.overallFraction = computeOverallFraction(status.stages, 0);
  status.updatedAt = new Date(nowMs).toISOString();
}

export function applyProgress(status: JobStatus, partial: Partial<JobProgress>): void {
  Object.assign(status.progress, partial);
  status.progress.overallFraction = computeOverallFraction(status.stages, status.progress.stageFraction);
}

function finishSuccess(status: JobStatus, outcome: Extract<PipelineOutcome, { kind: "SUCCEEDED" }>): void {
  for (const stage of status.stages) {
    if (stage.state === STAGE_STATE.PENDING) stage.state = STAGE_STATE.SKIPPED;
  }
  status.state = JOB_STATE.SUCCEEDED;
  status.gates = outcome.gates ?? null;
  status.testReport = outcome.testReport ?? null;
  status.leftovers = outcome.leftovers ?? [];
  status.progress.stageFraction = 1;
  status.progress.overallFraction = 1;
}

/** Moves a status to its terminal state. The running stage closes as DONE / FAILED / SKIPPED. */
export function finalizeStatus(status: JobStatus, outcome: PipelineOutcome, nowMs: number): void {
  const iso = new Date(nowMs).toISOString();
  const failedStage = status.stage;
  if (outcome.kind === "SUCCEEDED") {
    closeRunningStage(status, STAGE_STATE.DONE, nowMs);
    finishSuccess(status, outcome);
  } else if (outcome.kind === "FAILED") {
    closeRunningStage(status, STAGE_STATE.FAILED, nowMs);
    status.state = JOB_STATE.FAILED;
    status.error = { code: outcome.error.code, message: outcome.error.message, stage: failedStage };
  } else {
    closeRunningStage(status, STAGE_STATE.SKIPPED, nowMs);
    status.state = JOB_STATE.CANCELLED;
    status.cancelRequested = true;
  }
  status.stage = null;
  status.updatedAt = iso;
}

export function markCrashed(status: JobStatus, nowMs: number): void {
  finalizeStatus(status, { kind: "FAILED", error: { code: CRASH_ERROR.code, message: CRASH_ERROR.message } }, nowMs);
}
