import { readdir, rm, stat } from "node:fs/promises";
import { FILE_REMOVE_MAX_RETRIES, FILE_REMOVE_RETRY_DELAY_MS } from "../constants";
import { isValidJobId, jobPaths, jobsDir } from "../job/layout.ts";
import { writeStatusAtomic } from "../job/statusFile.ts";
import type { JobStatus } from "../job/types.ts";

export async function listJobIds(rootDir: string): Promise<string[]> {
  try {
    return (await readdir(jobsDir(rootDir))).filter(isValidJobId);
  } catch {
    return [];
  }
}

export async function fileMtimeMs(file: string): Promise<number | null> {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

/** Retries because Windows may still hold a handle on a file that was just closed. */
export async function removeJobDir(rootDir: string, jobId: string): Promise<void> {
  await rm(jobPaths(rootDir, jobId).dir, {
    recursive: true,
    force: true,
    maxRetries: FILE_REMOVE_MAX_RETRIES,
    retryDelay: FILE_REMOVE_RETRY_DELAY_MS,
  });
}

export async function removeJobPayload(rootDir: string, jobId: string): Promise<void> {
  const paths = jobPaths(rootDir, jobId);
  await rm(paths.source, { force: true });
  await rm(paths.upload, { force: true });
}

export function writeJobStatus(rootDir: string, status: JobStatus): Promise<void> {
  return writeStatusAtomic(rootDir, status.jobId, JSON.stringify(status, null, 2), { durable: true });
}
