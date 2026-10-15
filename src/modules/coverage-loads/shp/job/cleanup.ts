import { readdir, rm, stat } from "node:fs/promises";
import { ABANDONED_UPLOAD_MS, READY_ABANDONED_MS, RETENTION_MS, SHP_TABLES } from "./constants.ts";
import { isValidJobId, jobPaths, jobsDir } from "./layout.ts";
import { isJobDead } from "./liveness.ts";
import type { LivenessDeps } from "./liveness.ts";
import { isLockStale, readLock, releaseTableLock } from "./lock.ts";
import { isStartMarkerFresh } from "./startMarker.ts";
import { readStatus, writeStatusAtomic } from "./statusFile.ts";
import { finalizeStatus, markCrashed } from "./statusTransitions.ts";
import { JOB_STATE, isTerminalState } from "./types.ts";
import type { JobStatus } from "./types.ts";

export interface SweepDeps extends LivenessDeps {
  retentionMs?: number;
  abandonedUploadMs?: number;
}

export interface SweepSummary {
  abandonedUploads: string[];
  abandonedReady: string[];
  crashed: string[];
  expired: string[];
  sourcesRemoved: string[];
  locksRemoved: string[];
}

export type DiscardResult = { ok: true } | { ok: false; reason: "NOT_FOUND" | "NOT_TERMINAL" };

async function mtimeMs(file: string): Promise<number | null> {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

async function removeSource(jobId: string, rootDir: string): Promise<boolean> {
  const { source } = jobPaths(rootDir, jobId);
  if ((await mtimeMs(source)) === null) return false;
  await rm(source, { force: true });
  return true;
}

async function removeJobDir(rootDir: string, jobId: string): Promise<void> {
  await rm(jobPaths(rootDir, jobId).dir, { recursive: true, force: true });
}

async function lastGrowthMs(rootDir: string, status: JobStatus): Promise<number> {
  const partMtime = await mtimeMs(jobPaths(rootDir, status.jobId).upload);
  return Math.max(Date.parse(status.updatedAt) || 0, partMtime ?? 0);
}

/** READY (never started) -> CANCELLED. The source and the lock are released by the terminal pass. */
export async function cancelReadyStatus(rootDir: string, status: JobStatus, now: number): Promise<void> {
  finalizeStatus(status, { kind: "CANCELLED" }, now);
  await writeStatusAtomic(rootDir, status.jobId, JSON.stringify(status, null, 2), { durable: true });
}

async function isReadyAbandoned(rootDir: string, status: JobStatus, now: number): Promise<boolean> {
  if (await isStartMarkerFresh(rootDir, status.jobId, now)) return false;
  const lastTouch = Date.parse(status.heartbeatAt ?? status.updatedAt);
  return !Number.isNaN(lastTouch) && now - lastTouch > READY_ABANDONED_MS;
}

async function sweepOne(rootDir: string, jobId: string, now: number, deps: SweepDeps, summary: SweepSummary): Promise<void> {
  const status = await readStatus(rootDir, jobId);
  if (status === null) return;

  if (status.state === JOB_STATE.UPLOADING) {
    if (now - (await lastGrowthMs(rootDir, status)) <= (deps.abandonedUploadMs ?? ABANDONED_UPLOAD_MS)) return;
    await removeJobDir(rootDir, jobId);
    summary.abandonedUploads.push(jobId);
    return;
  }

  if (status.state === JOB_STATE.READY) {
    if (!(await isReadyAbandoned(rootDir, status, now))) return;
    await cancelReadyStatus(rootDir, status, now);
    summary.abandonedReady.push(jobId);
  }

  if (isJobDead(status, now, deps)) {
    markCrashed(status, now);
    await writeStatusAtomic(rootDir, jobId, JSON.stringify(status, null, 2), { durable: true });
    summary.crashed.push(jobId);
  }

  if (!isTerminalState(status.state)) return;
  if (await removeSource(jobId, rootDir)) summary.sourcesRemoved.push(jobId);
  if (await releaseTableLock(rootDir, status.target.table, jobId)) summary.locksRemoved.push(jobId);
  if (now - (Date.parse(status.updatedAt) || now) > (deps.retentionMs ?? RETENTION_MS)) {
    await removeJobDir(rootDir, jobId);
    summary.expired.push(jobId);
  }
}

async function sweepOrphanLocks(rootDir: string, now: number, deps: SweepDeps, summary: SweepSummary): Promise<void> {
  for (const table of SHP_TABLES) {
    const lock = await readLock(rootDir, table);
    if (lock === null || !(await isLockStale(rootDir, lock, table, { ...deps, now: () => now }))) continue;
    if (await releaseTableLock(rootDir, table, lock.jobId)) summary.locksRemoved.push(lock.jobId);
  }
}

async function listJobIds(rootDir: string): Promise<string[]> {
  try {
    return (await readdir(jobsDir(rootDir))).filter(isValidJobId);
  } catch {
    return [];
  }
}

/** Housekeeping pass for the Next-side API. Safe to run repeatedly and concurrently with jobs. */
export async function sweepJobs(rootDir: string, now: number, deps: SweepDeps = {}): Promise<SweepSummary> {
  const summary: SweepSummary = { abandonedUploads: [], abandonedReady: [], crashed: [], expired: [], sourcesRemoved: [], locksRemoved: [] };
  for (const jobId of await listJobIds(rootDir)) {
    await sweepOne(rootDir, jobId, now, deps, summary);
  }
  await sweepOrphanLocks(rootDir, now, deps, summary);
  return summary;
}

/** Deletes the folder of a TERMINAL job only. */
export async function discardJob(rootDir: string, jobId: string): Promise<DiscardResult> {
  const status = await readStatus(rootDir, jobId);
  if (status === null) return { ok: false, reason: "NOT_FOUND" };
  if (!isTerminalState(status.state)) return { ok: false, reason: "NOT_TERMINAL" };
  await removeJobDir(rootDir, jobId);
  return { ok: true };
}
