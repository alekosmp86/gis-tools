import type { DbConnection } from "../../types";
import { acquireTableLock, releaseTableLock, TableLockHeldError, updateLockPid } from "../job/lock.ts";
import { claimStartMarker, releaseStartMarker } from "../job/startMarker.ts";
import { readStatus } from "../job/statusFile.ts";
import { isTerminalState, JOB_STATE } from "../job/types.ts";
import type { JobMode, JobStatus } from "../job/types.ts";
import { writeJobStatus } from "./jobStore";
import type { ShpContext } from "./shpContext";
import { buildSpawnConfig, failIfStillReady, launchJob, SPAWN_FAILED_CODE, SPAWN_FAILED_MESSAGE } from "./spawnJob";

export type StartOutcome =
  | { readonly kind: "STARTED" }
  | { readonly kind: "LOCK_HELD"; readonly message: string }
  | { readonly kind: "ALREADY_STARTED" }
  | { readonly kind: "NOT_READY"; readonly state: string };

/**
 * Single-shot per job: an exclusive `start.lock` marker is claimed first, so a concurrent or
 * repeated start never spawns a second child. Then the table lock is taken BEFORE spawning and
 * the status is re-read: only a still-READY job proceeds, and RUNNING is never rewritten to READY
 * from a stale snapshot. A spawn failure frees marker and lock and leaves the job FAILED; the
 * error is rethrown for the handler to answer.
 */
export async function startJob(context: ShpContext, status: JobStatus, mode: JobMode, connection: DbConnection): Promise<StartOutcome> {
  const { jobId, target } = status;
  if (!(await claimStartMarker(context.rootDir, jobId, context.now()))) return { kind: "ALREADY_STARTED" };

  try {
    await acquireTableLock(context.rootDir, target.table, { jobId, pid: process.pid }, { now: context.now });
  } catch (error) {
    await releaseStartMarker(context.rootDir, jobId);
    if (error instanceof TableLockHeldError) return { kind: "LOCK_HELD", message: error.message };
    throw error;
  }

  try {
    const fresh = await readStatus(context.rootDir, jobId);
    if (fresh === null || fresh.state !== JOB_STATE.READY) {
      // The lock may belong to a job that is running: only a missing/terminal one gives it back.
      if (fresh === null || isTerminalState(fresh.state)) await releaseTableLock(context.rootDir, target.table, jobId);
      if (fresh === null || isTerminalState(fresh.state)) await releaseStartMarker(context.rootDir, jobId);
      return { kind: "NOT_READY", state: fresh?.state ?? "DESCONOCIDO" };
    }
    // The job refuses to start when its status mode differs from the config mode.
    await writeJobStatus(context.rootDir, { ...fresh, mode });
    const pid = launchJob(context, fresh, buildSpawnConfig(context, jobId, mode, connection));
    await updateLockPid(context.rootDir, target.table, { jobId, pid }).catch(() => undefined);
    return { kind: "STARTED" };
  } catch (error) {
    await failIfStillReady(context, jobId, SPAWN_FAILED_CODE, SPAWN_FAILED_MESSAGE).catch(() => undefined);
    await releaseTableLock(context.rootDir, target.table, jobId).catch(() => undefined);
    await releaseStartMarker(context.rootDir, jobId);
    throw error;
  }
}
