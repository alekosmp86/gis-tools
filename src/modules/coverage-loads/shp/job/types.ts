export const JOB_MODE = { LOAD: "LOAD", TEST: "TEST" } as const;
export type JobMode = (typeof JOB_MODE)[keyof typeof JOB_MODE];

export const JOB_STATE = {
  UPLOADING: "UPLOADING",
  READY: "READY",
  RUNNING: "RUNNING",
  CANCELLING: "CANCELLING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;
export type JobState = (typeof JOB_STATE)[keyof typeof JOB_STATE];

export const JOB_STAGE = {
  COPYING_FILE: "COPYING_FILE",
  READING: "READING",
  STAGING: "STAGING",
  SUBDIVIDING: "SUBDIVIDING",
  REPAIRING: "REPAIRING",
  SWAPPING: "SWAPPING",
  FINALIZING: "FINALIZING",
} as const;
export type JobStageId = (typeof JOB_STAGE)[keyof typeof JOB_STAGE];

export const STAGE_STATE = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  DONE: "DONE",
  SKIPPED: "SKIPPED",
  FAILED: "FAILED",
} as const;
export type StageState = (typeof STAGE_STATE)[keyof typeof STAGE_STATE];

export const LOG_LEVEL = { INFO: "INFO", WARN: "WARN", ERROR: "ERROR" } as const;
export type LogLevel = (typeof LOG_LEVEL)[keyof typeof LOG_LEVEL];

export const SHP_PREFIX_TABLE = {
  NRUruguay: "cobertura5g",
  WCDMAUruguay: "wcdma",
  NBIoTUruguay: "nbiot",
  LTEUruguay: "lte",
} as const;
export type ShpPrefix = keyof typeof SHP_PREFIX_TABLE;
export type ShpTable = (typeof SHP_PREFIX_TABLE)[ShpPrefix];

export const SCHEMA_VERSION = 1;

const TERMINAL_STATES: readonly JobState[] = [JOB_STATE.SUCCEEDED, JOB_STATE.FAILED, JOB_STATE.CANCELLED];
export const LIVE_STATES: readonly JobState[] = [JOB_STATE.RUNNING, JOB_STATE.CANCELLING];

export function isTerminalState(state: JobState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** Connection values live in the job process memory only; they are never written anywhere. */
export interface JobDbConnection {
  host: string;
  port: number;
  db_name: string;
  user: string;
  password: string;
}

export interface StageEntry {
  id: JobStageId;
  state: StageState;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
}

export interface JobProgress {
  bytesRead: number;
  bytesTotal: number;
  rowsCopied: number;
  piecesTotal: number;
  piecesRepaired: number;
  stageFraction: number;
  overallFraction: number;
}

export interface JobGates {
  stagingRows: number;
  maxVertices: number;
  invalidPieces: number;
  areaRelativeDiff: number;
  passed: boolean;
}

export interface TableMetrics {
  rows: number;
  vertices: number;
  area: number;
}

export interface TestReport {
  current: TableMetrics;
  new: TableMetrics;
  diff: TableMetrics;
}

export interface JobError {
  code: string;
  message: string;
  stage: JobStageId | null;
}

export interface JobTarget {
  table: ShpTable;
  prefix: ShpPrefix;
  fechaact: string;
}

export interface JobSource {
  fileName: string;
  sizeBytes: number;
  receivedBytes: number;
}

/** status.json v1. Never holds a password, host, user or any other connection detail. */
export interface JobStatus {
  schemaVersion: typeof SCHEMA_VERSION;
  jobId: string;
  mode: JobMode;
  target: JobTarget;
  source: JobSource;
  state: JobState;
  stage: JobStageId | null;
  stages: StageEntry[];
  progress: JobProgress;
  expectedMs: number;
  startedAt: string | null;
  updatedAt: string;
  heartbeatAt: string | null;
  pid: number | null;
  nodeVersion: string | null;
  gates: JobGates | null;
  testReport: TestReport | null;
  leftovers: string[];
  cancelRequested: boolean;
  error: JobError | null;
}
