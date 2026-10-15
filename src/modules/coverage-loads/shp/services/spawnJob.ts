import { closeSync, openSync } from "node:fs";
import path from "node:path";
import type { DbConnection } from "../../types";
import { CHILD_ENV_ALLOW_LIST, JOB_ENTRY_RELATIVE_PATH, JOB_NODE_ARGS } from "../constants";
import { EXIT_CODE } from "../job/constants.ts";
import type { JobSpawnConfig } from "../job/jobConfig.ts";
import { jobPaths } from "../job/layout.ts";
import { releaseTableLock } from "../job/lock.ts";
import { readStatus } from "../job/statusFile.ts";
import { finalizeStatus } from "../job/statusTransitions.ts";
import { JOB_STATE, LIVE_STATES } from "../job/types.ts";
import type { JobMode, JobStatus } from "../job/types.ts";
import { writeJobStatus } from "./jobStore";
import type { ShpContext } from "./shpContext";
import type { ChildLike } from "./spawnTypes";

export const SPAWN_FAILED_CODE = "SPAWN_FAILED";
export const SPAWN_FAILED_MESSAGE = "No se pudo iniciar el proceso de carga.";
const FAIL_RETRY_ATTEMPTS = 6;
const FAIL_RETRY_BACKOFF_MS = 40;
const STATUS_WRITE_FAILED_CODE = "STATUS_WRITE_FAILED";
const STATUS_WRITE_FAILED_MESSAGE = "El proceso de carga no pudo escribir su estado final. Revise el registro de la carga.";
const EARLY_EXIT_MESSAGE = (code: number | null) =>
  `El proceso de carga terminó antes de iniciar (código ${code ?? "desconocido"}). Revise el registro de la carga.`;

/** Only what node itself needs. No PG* variables, no credentials, no NODE_OPTIONS. */
function buildChildEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const name of CHILD_ENV_ALLOW_LIST) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  // Next's typing makes NODE_ENV mandatory on ProcessEnv; the job deliberately does not get it.
  return env as NodeJS.ProcessEnv;
}

function jobEntryPath(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), ...JOB_ENTRY_RELATIVE_PATH);
}

export function buildSpawnConfig(context: ShpContext, jobId: string, mode: JobMode, connection: DbConnection): JobSpawnConfig {
  const base: JobSpawnConfig = { jobId, mode, rootDir: context.rootDir, pipeline: context.pipelineMode, connection };
  return context.pipelineMode === "fake" ? { ...base, fake: context.fakeConfig } : base;
}

/** Marks a not-yet-started job FAILED and frees its table. A job that already moved on is left alone. */
export async function failIfStillReady(context: ShpContext, jobId: string, code: string, message: string): Promise<void> {
  const status = await readStatus(context.rootDir, jobId);
  if (status === null || status.state !== JOB_STATE.READY) return;
  finalizeStatus(status, { kind: "FAILED", error: { code, message } }, context.now());
  await writeJobStatus(context.rootDir, status);
  await releaseTableLock(context.rootDir, status.target.table, jobId);
}

/** The job exited because it could not record its final state: a still-live status is closed as FAILED here. */
async function failIfStillLive(context: ShpContext, jobId: string): Promise<void> {
  const status = await readStatus(context.rootDir, jobId);
  if (status === null || !LIVE_STATES.includes(status.state)) return;
  finalizeStatus(status, { kind: "FAILED", error: { code: STATUS_WRITE_FAILED_CODE, message: STATUS_WRITE_FAILED_MESSAGE } }, context.now());
  await writeJobStatus(context.rootDir, status);
  await releaseTableLock(context.rootDir, status.target.table, jobId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries failIfStillReady: readStatus reports a transiently unreadable file as null and the atomic
 * rename can exhaust its own retries under disk contention. When every attempt fails the lock is
 * still freed (best effort) so the READY sweeper can expire the job.
 */
async function failIfStillReadyWithRetry(context: ShpContext, jobId: string, code: string, message: string): Promise<void> {
  for (let attempt = 0; attempt < FAIL_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await failIfStillReady(context, jobId, code, message);
      const after = await readStatus(context.rootDir, jobId);
      if (after === null || after.state !== JOB_STATE.READY) return;
    } catch {
      // transient fs error: fall through to the backoff
    }
    await sleep(FAIL_RETRY_BACKOFF_MS * (attempt + 1));
  }
  const status = await readStatus(context.rootDir, jobId);
  if (status !== null && status.state === JOB_STATE.READY) await releaseTableLock(context.rootDir, status.target.table, jobId).catch(() => undefined);
}

function watchChild(context: ShpContext, child: ChildLike, jobId: string): void {
  child.once("error", () => void failIfStillReadyWithRetry(context, jobId, SPAWN_FAILED_CODE, SPAWN_FAILED_MESSAGE).catch(() => undefined));
  child.once("exit", (code) => {
    if (code === 0) return;
    if (code === EXIT_CODE.STATUS_WRITE_FAILED) void failIfStillLive(context, jobId).catch(() => undefined);
    void failIfStillReadyWithRetry(context, jobId, SPAWN_FAILED_CODE, EARLY_EXIT_MESSAGE(code)).catch(() => undefined);
  });
}

function sendConfig(child: ChildLike, config: JobSpawnConfig): void {
  child.stdin?.on("error", () => undefined);
  child.stdin?.write(`${JSON.stringify(config)}\n`);
  child.stdin?.end();
}

/**
 * Starts the detached job process. stdout and stderr go to job.log; the config (with the password)
 * goes through stdin only. Returns the child's pid; throws when the process could not be created.
 */
export function launchJob(context: ShpContext, status: JobStatus, config: JobSpawnConfig): number {
  const paths = jobPaths(context.rootDir, status.jobId);
  const logFd = openSync(paths.log, "a");
  try {
    const child = context.spawnProcess(process.execPath, [...JOB_NODE_ARGS, jobEntryPath()], {
      detached: true,
      windowsHide: true,
      stdio: ["pipe", logFd, logFd],
      cwd: paths.dir,
      env: buildChildEnv(),
    });
    watchChild(context, child, status.jobId);
    if (child.pid === undefined) throw new Error(SPAWN_FAILED_MESSAGE);
    sendConfig(child, config);
    child.unref();
    return child.pid;
  } finally {
    closeSync(logFd);
  }
}
