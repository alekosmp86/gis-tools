import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { CORRUPT_LOCK_STALE_MS, READY_LOCK_GRACE_MS } from "./constants.ts";
import { locksDir, lockPath } from "./layout.ts";
import { isJobDead, isPidAlive } from "./liveness.ts";
import type { LivenessDeps } from "./liveness.ts";
import { isStartMarkerFresh } from "./startMarker.ts";
import { readStatus } from "./statusFile.ts";
import { JOB_STATE, isTerminalState } from "./types.ts";
import type { JobStatus, ShpTable } from "./types.ts";

export interface LockOwner {
  jobId: string;
  pid: number;
}

export interface LockFile extends LockOwner {
  table: ShpTable;
  acquiredAt: string;
}

export interface LockDeps extends LivenessDeps {
  now?: () => number;
}

export class TableLockHeldError extends Error {
  readonly table: ShpTable;

  constructor(table: ShpTable) {
    super(`Ya hay una carga de ${table} en curso.`);
    this.name = "TableLockHeldError";
    this.table = table;
  }
}

function lockText(table: ShpTable, owner: LockOwner, now: number): string {
  const file: LockFile = { table, jobId: owner.jobId, pid: owner.pid, acquiredAt: new Date(now).toISOString() };
  return JSON.stringify(file);
}

export async function readLock(rootDir: string, table: ShpTable): Promise<LockFile | null> {
  try {
    const parsed = JSON.parse(await readFile(lockPath(rootDir, table), "utf8")) as Partial<LockFile>;
    return typeof parsed.jobId === "string" && typeof parsed.pid === "number" ? (parsed as LockFile) : null;
  } catch {
    return null;
  }
}

async function removeLockFile(rootDir: string, table: ShpTable): Promise<void> {
  await unlink(lockPath(rootDir, table)).catch(() => undefined);
}

async function isCorruptLockStale(rootDir: string, table: ShpTable, now: number): Promise<boolean> {
  try {
    return now - (await stat(lockPath(rootDir, table))).mtimeMs > CORRUPT_LOCK_STALE_MS;
  } catch {
    return true;
  }
}

/** A READY owner never ran: its lock is stale once the lock pid is dead, the READY grace passed and no start is in progress. */
async function isReadyLockStale(rootDir: string, lock: LockFile, status: JobStatus, now: number, deps: LockDeps): Promise<boolean> {
  if (await isStartMarkerFresh(rootDir, lock.jobId, now)) return false;
  const lastTouch = Date.parse(status.heartbeatAt ?? status.updatedAt);
  if (!Number.isNaN(lastTouch) && now - lastTouch <= READY_LOCK_GRACE_MS) return false;
  return !(deps.isPidAlive ?? isPidAlive)(lock.pid);
}

/** Stale when the owner's status is missing/terminal, or the owner is RUNNING-dead. */
export async function isLockStale(rootDir: string, lock: LockFile | null, table: ShpTable, deps: LockDeps = {}): Promise<boolean> {
  const now = (deps.now ?? Date.now)();
  if (lock === null) return isCorruptLockStale(rootDir, table, now);
  const status = await readStatus(rootDir, lock.jobId);
  if (status === null || isTerminalState(status.state)) return true;
  if (status.state === JOB_STATE.READY) return isReadyLockStale(rootDir, lock, status, now, deps);
  return isJobDead(status, now, deps);
}

async function createExclusive(rootDir: string, table: ShpTable, owner: LockOwner, now: number): Promise<boolean> {
  try {
    await writeFile(lockPath(rootDir, table), lockText(table, owner, now), { flag: "wx" });
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Windows reports a delete-pending lock file as EPERM/EACCES/EBUSY while another stealer unlinks it.
    if (code === "EEXIST" || code === "EPERM" || code === "EACCES" || code === "EBUSY") return false;
    throw error;
  }
}

/**
 * Creates `locks/<table>.json` exclusively. An existing lock owned by the same job is confirmed
 * (pid updated); a stale one is stolen; a live one throws `TableLockHeldError`.
 */
export async function acquireTableLock(rootDir: string, table: ShpTable, owner: LockOwner, deps: LockDeps = {}): Promise<void> {
  const now = (deps.now ?? Date.now)();
  await mkdir(locksDir(rootDir), { recursive: true });
  if (await createExclusive(rootDir, table, owner, now)) return;

  const existing = await readLock(rootDir, table);
  if (existing?.jobId === owner.jobId) return updateLockPid(rootDir, table, owner);
  if (!(await isLockStale(rootDir, existing, table, deps))) throw new TableLockHeldError(table);

  // Re-read right before stealing so a lock freshly taken by someone else is never removed.
  const confirm = await readLock(rootDir, table);
  if (confirm?.jobId !== existing?.jobId) throw new TableLockHeldError(table);
  await removeLockFile(rootDir, table);
  if (!(await createExclusive(rootDir, table, owner, now))) throw new TableLockHeldError(table);
  // Two stealers can both unlink; only the last writer's content survives, so confirm it is ours.
  if ((await readLock(rootDir, table))?.jobId !== owner.jobId) throw new TableLockHeldError(table);
}

export async function updateLockPid(rootDir: string, table: ShpTable, owner: LockOwner, deps: LockDeps = {}): Promise<void> {
  const now = (deps.now ?? Date.now)();
  await writeFile(lockPath(rootDir, table), lockText(table, owner, now), "utf8");
}

/** Removes the lock only when `jobId` owns it. Returns whether something was removed. */
export async function releaseTableLock(rootDir: string, table: ShpTable, jobId: string): Promise<boolean> {
  const existing = await readLock(rootDir, table);
  if (existing?.jobId !== jobId) return false;
  await removeLockFile(rootDir, table);
  return true;
}
