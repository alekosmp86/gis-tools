import { stat, unlink, writeFile } from "node:fs/promises";
import { START_MARKER_FRESH_MS } from "./constants.ts";
import { jobPaths } from "./layout.ts";

/** Exclusive-creates `start.lock`. False when a start already claimed this job. */
export async function claimStartMarker(rootDir: string, jobId: string, now: number): Promise<boolean> {
  try {
    await writeFile(jobPaths(rootDir, jobId).startLock, new Date(now).toISOString(), { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

export async function releaseStartMarker(rootDir: string, jobId: string): Promise<void> {
  await unlink(jobPaths(rootDir, jobId).startLock).catch(() => undefined);
}

/** True while a start is in progress for this job (marker younger than the freshness window). */
export async function isStartMarkerFresh(rootDir: string, jobId: string, now: number): Promise<boolean> {
  try {
    return now - (await stat(jobPaths(rootDir, jobId).startLock)).mtimeMs <= START_MARKER_FRESH_MS;
  } catch {
    return false;
  }
}
