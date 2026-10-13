import { isLockStale, readLock } from "../job/lock.ts";
import type { ShpTable } from "../job/types.ts";

/** The table lock as a caller sees it: free, held by this very job, or held by another live job. */
export type TableLockView = "FREE" | "OWN" | "OTHER";

export async function viewTableLock(rootDir: string, table: ShpTable, jobId: string | null, now: number): Promise<TableLockView> {
  const lock = await readLock(rootDir, table);
  if (lock === null) return "FREE";
  if (await isLockStale(rootDir, lock, table, { now: () => now })) return "FREE";
  return lock.jobId === jobId ? "OWN" : "OTHER";
}
