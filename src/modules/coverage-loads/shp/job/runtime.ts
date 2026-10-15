import { access } from "node:fs/promises";
import {
  CANCEL_POLL_INTERVAL_MS,
  HARD_KILL_GRACE_MS,
  HEARTBEAT_INTERVAL_MS,
  PROGRESS_WRITE_THROTTLE_MS,
  STATUS_FINAL_WRITE_ATTEMPTS,
} from "./constants.ts";
import { createJobLog } from "./jobLog.ts";
import { jobPaths } from "./layout.ts";
import type { CancelHook, JobContext, PipelineOutcome } from "./pipeline.ts";
import { errorText } from "./scrub.ts";
import type { Scrubber } from "./scrub.ts";
import { createStatusWriter } from "./statusFile.ts";
import { applyProgress, finalizeStatus, startStage } from "./statusTransitions.ts";
import { JOB_STATE, LOG_LEVEL } from "./types.ts";
import type { JobDbConnection, JobStageId, JobStatus, LogLevel } from "./types.ts";

export interface JobTiming {
  heartbeatMs: number;
  cancelPollMs: number;
  hardKillGraceMs: number;
  progressThrottleMs: number;
}

export const DEFAULT_TIMING: JobTiming = {
  heartbeatMs: HEARTBEAT_INTERVAL_MS,
  cancelPollMs: CANCEL_POLL_INTERVAL_MS,
  hardKillGraceMs: HARD_KILL_GRACE_MS,
  progressThrottleMs: PROGRESS_WRITE_THROTTLE_MS,
};

export interface TimerApi {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const GLOBAL_TIMERS: TimerApi = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface JobRuntimeOptions {
  rootDir: string;
  /** The READY status read from disk; the runtime owns and mutates it from here on. */
  status: JobStatus;
  connection: JobDbConnection;
  scrub: Scrubber;
  now?: () => number;
  timing?: Partial<JobTiming>;
  timers?: TimerApi;
  cancelRequested?: (cancelFile: string) => Promise<boolean>;
}

export interface JobRuntime {
  readonly context: JobContext;
  /** Resolves (never rejects) the first time a cancel request is observed. */
  readonly cancelObserved: Promise<void>;
  readonly timing: JobTiming;
  snapshot(): JobStatus;
  isCancelRequested(): boolean;
  log(level: LogLevel, message: string): void;
  begin(pid: number, nodeVersion: string): Promise<void>;
  startTimers(): void;
  stopTimers(): void;
  complete(outcome: PipelineOutcome): Promise<JobStatus>;
  close(): Promise<void>;
}

/** The terminal status could not be written even after every retry: the process must exit non-zero. */
export class FinalStatusWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinalStatusWriteError";
  }
}

async function fileExists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false
  );
}

/**
 * Owns the status file, the log and two INDEPENDENT timers (heartbeat, cancel poll). The timers
 * never wait on the pipeline, so a step stuck in one long DB statement still heartbeats and still
 * sees a cancel request.
 */
export function createJobRuntime(options: JobRuntimeOptions): JobRuntime {
  const { rootDir, status, connection, scrub } = options;
  const now = options.now ?? Date.now;
  const timing: JobTiming = { ...DEFAULT_TIMING, ...options.timing };
  const timers = options.timers ?? GLOBAL_TIMERS;
  const hasCancelFile = options.cancelRequested ?? fileExists;
  const paths = jobPaths(rootDir, status.jobId);
  const writer = createStatusWriter(rootDir, status.jobId);
  const jobLog = createJobLog(paths.log, scrub, now);
  const abort = new AbortController();

  let heartbeatHandle: unknown = null;
  let cancelHandle: unknown = null;
  let lastWriteAt = 0;
  let onCancel: CancelHook | null = null;
  let resolveCancelObserved: () => void = () => undefined;
  const cancelObserved = new Promise<void>((resolve) => {
    resolveCancelObserved = resolve;
  });

  const log = (level: LogLevel, message: string): void => jobLog.write(level, message);

  function persist(): Promise<void> {
    lastWriteAt = now();
    return writer.write(status);
  }

  function persistDurably(): Promise<void> {
    lastWriteAt = now();
    return writer.write(status, { durable: true });
  }

  async function persistFinal(attemptsLeft: number): Promise<void> {
    try {
      await persistDurably();
    } catch (error) {
      const reason = errorText(error, "error desconocido");
      log(LOG_LEVEL.ERROR, `No se pudo escribir el estado final en status.json: ${reason}`);
      if (attemptsLeft <= 1) throw new FinalStatusWriteError(reason);
      await persistFinal(attemptsLeft - 1);
    }
  }

  function persistQuietly(): void {
    persist().catch((error: unknown) => log(LOG_LEVEL.WARN, `No se pudo escribir status.json: ${errorText(error, "error desconocido")}`));
  }

  function touch(): void {
    status.heartbeatAt = status.updatedAt = new Date(now()).toISOString();
  }

  async function runCancelHook(): Promise<void> {
    if (!onCancel) return;
    const hook = onCancel;
    onCancel = null;
    try {
      await hook();
    } catch (error) {
      log(LOG_LEVEL.WARN, `El gancho de cancelación falló: ${errorText(error, "error desconocido")}`);
    }
  }

  async function observeCancel(): Promise<void> {
    if (status.cancelRequested) return;
    status.cancelRequested = true;
    status.state = JOB_STATE.CANCELLING;
    touch();
    log(LOG_LEVEL.WARN, "Cancelación solicitada.");
    persistQuietly();
    abort.abort();
    resolveCancelObserved();
    await runCancelHook();
  }

  function pollCancel(): void {
    if (status.cancelRequested) return;
    hasCancelFile(paths.cancel)
      .then((requested) => (requested ? observeCancel() : undefined))
      .catch((error: unknown) => log(LOG_LEVEL.WARN, `Fallo al revisar cancelación: ${errorText(error, "error desconocido")}`));
  }

  function beat(): void {
    touch();
    persistQuietly();
  }

  const context: JobContext = {
    signal: abort.signal,
    mode: status.mode,
    target: status.target,
    sourcePath: paths.source,
    connection,
    log,
    setStage(id: JobStageId) {
      startStage(status, id, now());
      log(LOG_LEVEL.INFO, `Etapa ${id} iniciada.`);
      persistQuietly();
    },
    updateProgress(partial) {
      applyProgress(status, partial);
      if (now() - lastWriteAt >= timing.progressThrottleMs) persistQuietly();
    },
    registerOnCancel(hook) {
      onCancel = hook;
      if (hook && status.cancelRequested) void runCancelHook();
    },
  };

  return {
    context,
    cancelObserved,
    timing,
    snapshot: () => status,
    isCancelRequested: () => status.cancelRequested,
    log,
    async begin(pid, nodeVersion) {
      status.state = JOB_STATE.RUNNING;
      status.pid = pid;
      status.nodeVersion = nodeVersion;
      status.startedAt = new Date(now()).toISOString();
      touch();
      await persistDurably();
    },
    startTimers() {
      heartbeatHandle = timers.setInterval(beat, timing.heartbeatMs);
      cancelHandle = timers.setInterval(pollCancel, timing.cancelPollMs);
    },
    stopTimers() {
      if (heartbeatHandle !== null) timers.clearInterval(heartbeatHandle);
      if (cancelHandle !== null) timers.clearInterval(cancelHandle);
      heartbeatHandle = cancelHandle = null;
    },
    async complete(outcome) {
      const settled: PipelineOutcome =
        outcome.kind === "FAILED" ? { kind: "FAILED", error: { ...outcome.error, message: scrub(outcome.error.message) } } : outcome;
      finalizeStatus(status, settled, now());
      touch();
      await persistFinal(STATUS_FINAL_WRITE_ATTEMPTS);
      log(LOG_LEVEL.INFO, `Carga finalizada: ${status.state}.`);
      return status;
    },
    close: () => jobLog.close(),
  };
}
