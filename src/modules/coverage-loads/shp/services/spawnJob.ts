import { closeSync, openSync } from "node:fs";
import path from "node:path";
import type { DbConnection } from "../../types";
import { CHILD_ENV_ALLOW_LIST, JOB_ENTRY_RELATIVE_PATH, JOB_NODE_ARGS } from "../constants";
import type { JobSpawnConfig } from "../job/jobConfig.ts";
import { jobPaths } from "../job/layout.ts";
import { releaseTableLock } from "../job/lock.ts";
import { readStatus } from "../job/statusFile.ts";
import { finalizeStatus } from "../job/statusTransitions.ts";
import { JOB_STATE } from "../job/types.ts";
import type { JobMode, JobStatus } from "../job/types.ts";
import { writeJobStatus } from "./jobStore";
import type { ShpContext } from "./shpContext";
import type { ChildLike } from "./spawnTypes";

export const SPAWN_FAILED_CODE = "SPAWN_FAILED";
export const SPAWN_FAILED_MESSAGE = "No se pudo iniciar el proceso de carga.";
const EARLY_EXIT_MESSAGE = (code: number | null) =>
  `El proceso de carga terminó antes de iniciar (código ${code ?? "desconocido"}). Revise el registro de la carga.`;

/** Only what node itself needs. No PG* variables, no credentials, no NODE_OPTIONS. */
export function buildChildEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const name of CHILD_ENV_ALLOW_LIST) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  // Next's typing makes NODE_ENV mandatory on ProcessEnv; the job deliberately does not get it.
  return env as NodeJS.ProcessEnv;
}

export function jobEntryPath(): string {
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

function watchChild(context: ShpContext, child: ChildLike, jobId: string): void {
  child.once("error", () => void failIfStillReady(context, jobId, SPAWN_FAILED_CODE, SPAWN_FAILED_MESSAGE).catch(() => undefined));
  child.once(
    "exit",
    (code) => {
      if (code === 0) return;
      void failIfStillReady(context, jobId, SPAWN_FAILED_CODE, EARLY_EXIT_MESSAGE(code)).catch(() => undefined);
    }
  );
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
