// Same run-store API names as fullReplaceRunStore; fixed by tests/unit/core/services/shpReplaceRunStore.test.ts.
// fallow-ignore-file duplicate-export
import { describeDbServer } from "@/core/services/fullReplaceRunStore";
import type { ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import {
  fetchShpReplaceStatus,
  startShpReplace,
  uploadShapefileZip,
  type ShpStartBody,
  type ShpStartResult,
  type ShpUploadProgress,
  type ShpUploadResult,
} from "@/core/services/shpReplaceClient";
import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { ShpJobSnapshot } from "@/core/services/server/shpReplace/shpReplaceJobStore";
import type { ShpReplaceResult } from "@/core/services/server/shpReplace/shpReplaceTypes";
import type { DbConfig } from "@/core/types/db";
import { ShpJobState, type ShpReplacePhase } from "@/core/types/shpReplace";

export const ShpReplaceRunStatus = {
  IDLE: "idle",
  UPLOADING: "uploading",
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
} as const;

export type ShpReplaceRunStatus = (typeof ShpReplaceRunStatus)[keyof typeof ShpReplaceRunStatus];

export interface ShpReplaceRunContext {
  targetLabel: string;
  targetServer: string;
  fileName: string;
  startedAt: number;
}

export interface ShpReplaceRunState {
  status: ShpReplaceRunStatus;
  uploadPct: number;
  phase: ShpReplacePhase | null;
  current: number;
  total: number;
  result: ShpReplaceResult | null;
  error: string | null;
  context: ShpReplaceRunContext | null;
  jobId: string | null;
  outcomeUnknown: boolean;
}

export interface ShpReplaceRunClient {
  upload: (file: Blob, onProgress?: ShpUploadProgress) => Promise<ShpUploadResult>;
  start: (body: ShpStartBody) => Promise<ShpStartResult>;
  status: (jobId: string) => Promise<ShpJobSnapshot>;
}

export interface ShpReplaceRunParams {
  file: Blob;
  fileName: string;
  connection: DbConfig;
  mapping: ReplaceColumnMapping;
  sourceSrid: number;
  resetSequences: boolean;
  pollIntervalMs?: number;
  pollFailureGraceMs?: number;
  client?: ShpReplaceRunClient;
}

interface PollTiming {
  intervalMs: number;
  failureGraceMs: number;
}

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_POLL_FAILURE_GRACE_MS = 60_000;
const UNKNOWN_RUN_ERROR = "Error desconocido durante el reemplazo completo.";
const JOB_FAILED_ERROR = "El reemplazo falló en el servidor.";
const statusFailureMessage = (jobId: string): string =>
  `Se perdió la conexión con el servidor al consultar el trabajo ${jobId}.`;

const DEFAULT_CLIENT: ShpReplaceRunClient = {
  upload: uploadShapefileZip,
  start: startShpReplace,
  status: fetchShpReplaceStatus,
};

const IDLE_STATE: ShpReplaceRunState = {
  status: ShpReplaceRunStatus.IDLE,
  uploadPct: 0,
  phase: null,
  current: 0,
  total: 0,
  result: null,
  error: null,
  context: null,
  jobId: null,
  outcomeUnknown: false,
};

let state: ShpReplaceRunState = IDLE_STATE;
const listeners = new Set<() => void>();

const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();

function setState(next: ShpReplaceRunState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function registerBeforeUnload(): void {
  if (typeof window !== "undefined") window.addEventListener("beforeunload", warnBeforeUnload);
}

function unregisterBeforeUnload(): void {
  if (typeof window !== "undefined") window.removeEventListener("beforeunload", warnBeforeUnload);
}

const isBusy = (status: ShpReplaceRunStatus): boolean =>
  status === ShpReplaceRunStatus.UPLOADING || status === ShpReplaceRunStatus.RUNNING;

const toPercent = (loaded: number, total: number): number =>
  total > 0 ? Math.round((loaded / total) * 100) : 0;

const describeRunError = (error: unknown): string =>
  error instanceof Error && error.message.trim() !== "" ? error.message : UNKNOWN_RUN_ERROR;

const sleep = (milliseconds: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getSnapshot = (): ShpReplaceRunState => state;

export const getServerSnapshot = (): ShpReplaceRunState => IDLE_STATE;

function buildRunContext(params: ShpReplaceRunParams): ShpReplaceRunContext {
  const { connection } = params;
  return {
    targetLabel: buildQualifiedTableLabel(connection.schema_name, connection.table_name),
    targetServer: describeDbServer(connection),
    fileName: params.fileName,
    startedAt: Date.now(),
  };
}

function buildStartBody(params: ShpReplaceRunParams, uploadId: string): ShpStartBody {
  const { connection } = params;
  return {
    host: connection.host,
    port: connection.port,
    db_name: connection.db_name,
    user: connection.user,
    password: connection.password ?? "",
    schema_name: connection.schema_name,
    table_name: connection.table_name,
    uploadId,
    mapping: params.mapping,
    sourceSrid: params.sourceSrid,
    resetSequences: params.resetSequences,
    confirm: true,
  };
}

function handleUploadProgress(loaded: number, total: number): void {
  setState({ ...state, uploadPct: toPercent(loaded, total) });
}

const isSettledJob = (job: ShpJobSnapshot): boolean =>
  job.state === ShpJobState.DONE || job.state === ShpJobState.FAILED;

function applySettledJob(job: ShpJobSnapshot): void {
  if (job.state === ShpJobState.DONE) {
    setState({ ...state, status: ShpReplaceRunStatus.DONE, result: job.result ?? null, error: null });
    return;
  }
  setState({
    ...state,
    status: ShpReplaceRunStatus.FAILED,
    result: null,
    error: job.error ?? JOB_FAILED_ERROR,
    outcomeUnknown: job.outcomeUnknown ?? false,
  });
}

function applyRunningJob(job: ShpJobSnapshot): void {
  setState({ ...state, phase: job.phase, current: job.current ?? 0, total: job.total ?? 0 });
}

async function fetchJobOrNull(jobId: string, client: ShpReplaceRunClient): Promise<ShpJobSnapshot | null> {
  try {
    return await client.status(jobId);
  } catch {
    return null;
  }
}

async function pollUntilSettled(jobId: string, client: ShpReplaceRunClient, timing: PollTiming): Promise<void> {
  let failingSince: number | null = null;
  while (failingSince === null || Date.now() - failingSince < timing.failureGraceMs) {
    await sleep(timing.intervalMs);
    const job = await fetchJobOrNull(jobId, client);
    if (!job) {
      failingSince ??= Date.now();
      continue;
    }
    failingSince = null;
    if (isSettledJob(job)) {
      applySettledJob(job);
      return;
    }
    applyRunningJob(job);
  }
  setState({ ...state, status: ShpReplaceRunStatus.FAILED, error: statusFailureMessage(jobId), outcomeUnknown: true });
}

function buildPollTiming(params: ShpReplaceRunParams): PollTiming {
  return {
    intervalMs: params.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    failureGraceMs: params.pollFailureGraceMs ?? DEFAULT_POLL_FAILURE_GRACE_MS,
  };
}

export async function start(params: ShpReplaceRunParams): Promise<void> {
  if (isBusy(state.status)) return;
  const client = params.client ?? DEFAULT_CLIENT;
  setState({ ...IDLE_STATE, status: ShpReplaceRunStatus.UPLOADING, context: buildRunContext(params) });
  registerBeforeUnload();

  try {
    const upload = await client.upload(params.file, handleUploadProgress);
    const { jobId } = await client.start(buildStartBody(params, upload.uploadId));
    setState({ ...state, status: ShpReplaceRunStatus.RUNNING, uploadPct: 100, jobId });
    unregisterBeforeUnload();
    void pollUntilSettled(jobId, client, buildPollTiming(params));
  } catch (runError: unknown) {
    setState({ ...state, status: ShpReplaceRunStatus.FAILED, error: describeRunError(runError) });
  } finally {
    unregisterBeforeUnload();
  }
}

export function reset(): void {
  if (isBusy(state.status) || state.status === ShpReplaceRunStatus.IDLE) return;
  setState(IDLE_STATE);
}
