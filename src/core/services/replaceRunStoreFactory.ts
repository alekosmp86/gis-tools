import { describeDbServer } from "@/core/services/fullReplaceRunStore";
import {
  ShpReplaceRunStatus,
  type ShpReplaceRerunParams,
  type ShpReplaceResetOptions,
  type ShpReplaceRunClient,
  type ShpReplaceRunContext,
  type ShpReplaceRunParams,
  type ShpReplaceRunState,
} from "@/core/services/replaceRunTypes";
import type { ShpStartBody } from "@/core/services/shpReplaceClient";
import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { ShpJobSnapshot } from "@/core/services/server/shpReplace/shpReplaceJobStore";
import { DEFAULT_GEOMETRY_PROCESSING } from "@/core/types/geometryProcessing";
import { ShpJobState } from "@/core/types/shpReplace";

interface PollTiming {
  intervalMs: number;
  failureGraceMs: number;
}

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_POLL_FAILURE_GRACE_MS = 60_000;
const UNKNOWN_RUN_ERROR = "Error desconocido durante el reemplazo completo.";
const UNKNOWN_ANALYSIS_ERROR = "Error desconocido durante el análisis.";
const JOB_FAILED_ERROR = "El reemplazo falló en el servidor.";
const ANALYSIS_FAILED_ERROR = "El análisis falló en el servidor.";
const statusFailureMessage = (jobId: string): string =>
  `Se perdió la conexión con el servidor al consultar el trabajo ${jobId}.`;

const IDLE_STATE: ShpReplaceRunState = {
  status: ShpReplaceRunStatus.IDLE,
  uploadPct: 0,
  phase: null,
  detail: null,
  current: 0,
  total: 0,
  result: null,
  error: null,
  context: null,
  jobId: null,
  outcomeUnknown: false,
  uploadId: null,
  dryRun: false,
  report: null,
};

const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();

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

const describeRunError = (error: unknown, dryRun: boolean): string => {
  if (error instanceof Error && error.message.trim() !== "") return error.message;
  return dryRun ? UNKNOWN_ANALYSIS_ERROR : UNKNOWN_RUN_ERROR;
};

const sleep = (milliseconds: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const isSettledJob = (job: ShpJobSnapshot): boolean =>
  job.state === ShpJobState.DONE || job.state === ShpJobState.FAILED;

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
    geometryProcessing: params.processing ?? DEFAULT_GEOMETRY_PROCESSING,
    dryRun: params.dryRun ?? false,
    confirm: true,
  };
}

function buildPollTiming(params: ShpReplaceRunParams): PollTiming {
  return {
    intervalMs: params.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    failureGraceMs: params.pollFailureGraceMs ?? DEFAULT_POLL_FAILURE_GRACE_MS,
  };
}

const withoutPassword = (params: ShpReplaceRunParams): ShpReplaceRunParams => ({
  ...params,
  connection: { ...params.connection, password: undefined },
});

async function fetchJobOrNull(jobId: string, client: ShpReplaceRunClient): Promise<ShpJobSnapshot | null> {
  try {
    return await client.status(jobId);
  } catch {
    return null;
  }
}

export class ReplaceRunStore {
  private state: ShpReplaceRunState = IDLE_STATE;
  private lastRunParams: ShpReplaceRunParams | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly defaultClient: ShpReplaceRunClient) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ShpReplaceRunState => this.state;

  getServerSnapshot = (): ShpReplaceRunState => IDLE_STATE;

  start = async (params: ShpReplaceRunParams): Promise<void> => {
    if (isBusy(this.state.status)) return;
    const client = params.client ?? this.defaultClient;
    this.lastRunParams = withoutPassword(params);
    this.setState({
      ...IDLE_STATE,
      status: ShpReplaceRunStatus.UPLOADING,
      context: buildRunContext(params),
      uploadId: params.uploadId ?? null,
      dryRun: params.dryRun ?? false,
    });
    registerBeforeUnload();

    try {
      const uploadId = await this.resolveUploadId(params, client);
      const { jobId } = await client.start(buildStartBody(params, uploadId));
      this.setState({ ...this.state, status: ShpReplaceRunStatus.RUNNING, uploadPct: 100, jobId });
      unregisterBeforeUnload();
      void this.pollUntilSettled(jobId, client, buildPollTiming(params));
    } catch (runError: unknown) {
      this.setState({
        ...this.state,
        status: ShpReplaceRunStatus.FAILED,
        error: describeRunError(runError, this.state.dryRun),
      });
    } finally {
      unregisterBeforeUnload();
    }
  };

  reset = (options: ShpReplaceResetOptions = {}): void => {
    const hasNothingToReset = this.state.status === ShpReplaceRunStatus.IDLE && this.state.uploadId === null;
    if (isBusy(this.state.status) || hasNothingToReset) return;
    this.lastRunParams = options.keepUpload ? this.lastRunParams : null;
    this.setState({ ...IDLE_STATE, uploadId: options.keepUpload ? this.state.uploadId : null });
  };

  rerun = async ({ password, processing, dryRun }: ShpReplaceRerunParams): Promise<void> => {
    if (!this.lastRunParams || isBusy(this.state.status)) return;
    await this.start({
      ...this.lastRunParams,
      connection: { ...this.lastRunParams.connection, password },
      processing,
      dryRun,
      uploadId: this.state.uploadId ?? undefined,
    });
  };

  private setState(next: ShpReplaceRunState): void {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }

  private handleUploadProgress = (loaded: number, total: number): void => {
    this.setState({ ...this.state, uploadPct: toPercent(loaded, total) });
  };

  private async resolveUploadId(params: ShpReplaceRunParams, client: ShpReplaceRunClient): Promise<string> {
    if (params.uploadId !== undefined) return params.uploadId;
    const upload = await client.upload(params.file, this.handleUploadProgress);
    this.setState({ ...this.state, uploadId: upload.uploadId });
    return upload.uploadId;
  }

  private applySettledJob(job: ShpJobSnapshot): void {
    if (job.state === ShpJobState.DONE) {
      this.setState({
        ...this.state,
        status: ShpReplaceRunStatus.DONE,
        result: job.result ?? null,
        error: null,
        detail: null,
        report: job.report ?? null,
      });
      return;
    }
    this.setState({
      ...this.state,
      status: ShpReplaceRunStatus.FAILED,
      result: null,
      detail: null,
      error: job.error ?? (this.state.dryRun ? ANALYSIS_FAILED_ERROR : JOB_FAILED_ERROR),
      outcomeUnknown: job.outcomeUnknown ?? false,
      report: job.report ?? null,
    });
  }

  private applyRunningJob(job: ShpJobSnapshot): void {
    this.setState({
      ...this.state,
      phase: job.phase,
      detail: job.detail ?? null,
      current: job.current ?? 0,
      total: job.total ?? 0,
    });
  }

  private async pollUntilSettled(jobId: string, client: ShpReplaceRunClient, timing: PollTiming): Promise<void> {
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
        this.applySettledJob(job);
        return;
      }
      this.applyRunningJob(job);
    }
    this.setState({
      ...this.state,
      status: ShpReplaceRunStatus.FAILED,
      error: statusFailureMessage(jobId),
      outcomeUnknown: true,
    });
  }
}
