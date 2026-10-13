import { FORCE_KILL_AFTER_MS } from "../constants";
import { DEAD_JOB_HEARTBEAT_MS } from "../job/constants.ts";
import { sweepJobs } from "../job/cleanup.ts";
import { jobPaths } from "../job/layout.ts";
import { releaseTableLock } from "../job/lock.ts";
import { readStatus } from "../job/statusFile.ts";
import { finalizeStatus } from "../job/statusTransitions.ts";
import { LIVE_STATES } from "../job/types.ts";
import type { JobStatus } from "../job/types.ts";
import { fileMtimeMs, listJobIds, removeJobPayload, writeJobStatus } from "./jobStore";
import type { ShpBaseContext } from "./shpContext";

export const FORCE_KILLED_ERROR = {
  code: "FORCE_KILLED",
  message: "La carga no respondió a la cancelación y se terminó el proceso a la fuerza.",
} as const;

export interface Sweeper {
  /** Runs the sweep on the first call of the process only. */
  once(): Promise<void>;
  /** Runs the sweep now unless one is already in flight. */
  sweep(): Promise<void>;
}

async function isOverdueForKill(context: ShpBaseContext, status: JobStatus): Promise<boolean> {
  if (!LIVE_STATES.includes(status.state) || status.pid === null) return false;
  const requestedAt = await fileMtimeMs(jobPaths(context.rootDir, status.jobId).cancel);
  if (requestedAt === null || context.now() - requestedAt <= FORCE_KILL_AFTER_MS) return false;
  // A pid without a fresh heartbeat may have been reused by an unrelated process: never SIGKILL it.
  const lastBeat = Date.parse(status.heartbeatAt ?? status.updatedAt);
  if (Number.isNaN(lastBeat) || context.now() - lastBeat > DEAD_JOB_HEARTBEAT_MS) return false;
  return context.isPidAlive(status.pid);
}

async function forceKill(context: ShpBaseContext, status: JobStatus): Promise<void> {
  const stage = status.stage;
  try {
    context.killProcess(status.pid as number);
  } catch {
    // The process may have exited between the liveness check and the kill; finalising is still right.
  }
  finalizeStatus(status, { kind: "CANCELLED" }, context.now());
  status.error = { code: FORCE_KILLED_ERROR.code, message: FORCE_KILLED_ERROR.message, stage };
  await writeJobStatus(context.rootDir, status);
  await removeJobPayload(context.rootDir, status.jobId).catch(() => undefined);
  await releaseTableLock(context.rootDir, status.target.table, status.jobId);
}

/** Kills the processes that ignored a cancel for 2x the hard-kill grace. Runs before the crash sweep. */
async function killStuckCancels(context: ShpBaseContext): Promise<void> {
  const jobIds = await listJobIds(context.rootDir);
  await Promise.all(
    jobIds.map(async (jobId) => {
      const status = await readStatus(context.rootDir, jobId);
      if (status !== null && (await isOverdueForKill(context, status))) await forceKill(context, status);
    })
  );
}

async function runSweep(context: ShpBaseContext): Promise<void> {
  await killStuckCancels(context);
  await sweepJobs(context.rootDir, context.now(), { isPidAlive: context.isPidAlive });
}

/** Lazy housekeeping: no timers, never overlaps itself, never throws into a response. */
export function createSweeper(context: ShpBaseContext): Sweeper {
  let inFlight: Promise<void> | null = null;
  let hasRun = false;

  function sweep(): Promise<void> {
    hasRun = true;
    if (inFlight !== null) return inFlight;
    inFlight = runSweep(context)
      .catch(() => undefined)
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  return {
    sweep,
    once: () => (hasRun ? Promise.resolve() : sweep()),
  };
}
