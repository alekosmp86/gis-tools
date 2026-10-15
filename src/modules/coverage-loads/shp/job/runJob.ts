import { rm } from "node:fs/promises";
import { EXIT_CODE } from "./constants.ts";
import { installFatalGuard } from "./fatalGuard.ts";
import { createFakePipeline } from "./fakePipeline.ts";
import type { JobSpawnConfig } from "./jobConfig.ts";
import { jobPaths } from "./layout.ts";
import { acquireTableLock, releaseTableLock, TableLockHeldError } from "./lock.ts";
import type { LockDeps } from "./lock.ts";
import type { JobPipeline, PipelineOutcome } from "./pipeline.ts";
import { createRealPipeline } from "./realPipeline.ts";
import { createJobRuntime, FinalStatusWriteError } from "./runtime.ts";
import type { JobRuntime, TimerApi } from "./runtime.ts";
import { createScrubber, errorText } from "./scrub.ts";
import type { Scrubber } from "./scrub.ts";
import { readStatus } from "./statusFile.ts";
import { JOB_STATE, LOG_LEVEL } from "./types.ts";
import type { JobState, JobStatus } from "./types.ts";

export type ExitCode = (typeof EXIT_CODE)[keyof typeof EXIT_CODE];

export interface RunJobDeps extends LockDeps {
  rootDir: string;
  pid?: number;
  nodeVersion?: string;
  timers?: TimerApi;
  /** Replaces the pipeline chosen by `config.pipeline` (tests). */
  pipeline?: JobPipeline;
}

const EXIT_BY_STATE: Partial<Record<JobState, ExitCode>> = {
  [JOB_STATE.SUCCEEDED]: EXIT_CODE.SUCCEEDED,
  [JOB_STATE.FAILED]: EXIT_CODE.FAILED,
  [JOB_STATE.CANCELLED]: EXIT_CODE.CANCELLED,
};

function secretsOf(config: JobSpawnConfig): string[] {
  const { password, host, user, db_name } = config.connection;
  return [password, host, user, db_name, ...(config.secretsToScrub ?? [])];
}

function choosePipeline(config: JobSpawnConfig, override?: JobPipeline): JobPipeline {
  if (override) return override;
  return config.pipeline === "fake" && config.fake ? createFakePipeline(config.fake) : createRealPipeline();
}

function failed(code: string, message: string): PipelineOutcome {
  return { kind: "FAILED", error: { code, message } };
}

/** After the cancel grace period the job is finalised as CANCELLED even if the pipeline never settles. */
function forceCancelAfterGrace(runtime: JobRuntime): { promise: Promise<PipelineOutcome>; dispose(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  const promise = runtime.cancelObserved.then(
    () =>
      new Promise<PipelineOutcome>((resolve) => {
        if (disposed) return;
        timer = setTimeout(() => resolve({ kind: "CANCELLED" }), runtime.timing.hardKillGraceMs);
      })
  );
  return {
    promise,
    dispose() {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
    },
  };
}

async function runPipeline(pipeline: JobPipeline, runtime: JobRuntime, scrub: Scrubber): Promise<PipelineOutcome> {
  const guard = installFatalGuard(scrub);
  const forced = forceCancelAfterGrace(runtime);
  const settled = Promise.resolve()
    .then(() => pipeline.run(runtime.context))
    .catch((error: unknown) => failed("PIPELINE_ERROR", scrub(errorText(error, "La carga falló por un error desconocido."))));
  try {
    const outcome = await Promise.race([settled, forced.promise, guard.promise]);
    return outcome.kind === "FAILED" && runtime.isCancelRequested() ? { kind: "CANCELLED" } : outcome;
  } finally {
    forced.dispose();
    guard.dispose();
  }
}

async function finish(runtime: JobRuntime, deps: RunJobDeps, status: JobStatus, outcome: PipelineOutcome): Promise<ExitCode> {
  runtime.stopTimers();
  await rm(jobPaths(deps.rootDir, status.jobId).source, { force: true }).catch(() => undefined);
  try {
    const final = await runtime.complete(outcome);
    return EXIT_BY_STATE[final.state] ?? EXIT_CODE.FAILED;
  } catch (error) {
    if (error instanceof FinalStatusWriteError) return EXIT_CODE.STATUS_WRITE_FAILED;
    throw error;
  } finally {
    await releaseTableLock(deps.rootDir, status.target.table, status.jobId).catch(() => undefined);
  }
}

async function acquireLock(deps: RunJobDeps, status: JobStatus): Promise<PipelineOutcome | null> {
  try {
    await acquireTableLock(deps.rootDir, status.target.table, { jobId: status.jobId, pid: deps.pid ?? process.pid }, deps);
    return null;
  } catch (error) {
    const held = error instanceof TableLockHeldError;
    return failed(held ? "TABLE_LOCKED" : "LOCK_ERROR", errorText(error, "No se pudo tomar el bloqueo de la tabla."));
  }
}

async function execute(config: JobSpawnConfig, runtime: JobRuntime, deps: RunJobDeps, status: JobStatus): Promise<ExitCode> {
  const scrub = createScrubber(secretsOf(config));
  let outcome = await acquireLock(deps, status);
  if (outcome === null) {
    try {
      await runtime.begin(deps.pid ?? process.pid, deps.nodeVersion ?? process.versions.node);
      runtime.log(LOG_LEVEL.INFO, `Carga iniciada: modo ${status.mode}, tabla ${status.target.table}.`);
      runtime.startTimers();
      outcome = await runPipeline(choosePipeline(config, deps.pipeline), runtime, scrub);
    } catch (error) {
      outcome = failed("JOB_ERROR", scrub(errorText(error, "La carga falló por un error desconocido.")));
    }
  }
  return finish(runtime, deps, status, outcome);
}

/**
 * Runs one job end to end. Returns the process exit code; never throws once the job is READY.
 * `BAD_CONFIG` means the job could not even start (missing or not-READY status), so nothing was written.
 */
export async function runJob(config: JobSpawnConfig, deps: RunJobDeps): Promise<ExitCode> {
  const status = await readStatus(deps.rootDir, config.jobId);
  if (status === null || status.state !== JOB_STATE.READY || status.mode !== config.mode) return EXIT_CODE.BAD_CONFIG;

  const runtime = createJobRuntime({
    rootDir: deps.rootDir,
    status,
    connection: config.connection,
    scrub: createScrubber(secretsOf(config)),
    now: deps.now,
    timing: config.timing,
    timers: deps.timers,
  });
  try {
    return await execute(config, runtime, deps, status);
  } catch {
    return EXIT_CODE.FAILED;
  } finally {
    await runtime.close();
  }
}
