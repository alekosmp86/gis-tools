import { readFile, rename, writeFile } from "node:fs/promises";
import { STATUS_RENAME_BACKOFF_MS, STATUS_RENAME_RETRIES } from "./constants.ts";
import { jobPaths } from "./layout.ts";
import { SCHEMA_VERSION } from "./types.ts";
import type { JobStatus } from "./types.ts";

const RETRYABLE_RENAME_CODES = ["EPERM", "EBUSY", "EACCES"];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableRename(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && RETRYABLE_RENAME_CODES.includes(code);
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      // Windows refuses to replace a file a reader has open; the reader's handle is short-lived.
      if (!isRetryableRename(error) || attempt >= STATUS_RENAME_RETRIES) throw error;
      await sleep(STATUS_RENAME_BACKOFF_MS * (attempt + 1));
    }
  }
}

/** Writes `status.json.tmp` then renames it over `status.json`, so a reader never sees half a file. */
export async function writeStatusAtomic(rootDir: string, jobId: string, text: string): Promise<void> {
  const paths = jobPaths(rootDir, jobId);
  await writeFile(paths.statusTmp, text, "utf8");
  await renameWithRetry(paths.statusTmp, paths.status);
}

function isStatusShape(value: unknown): value is JobStatus {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<JobStatus>;
  return candidate.schemaVersion === SCHEMA_VERSION && typeof candidate.jobId === "string" && typeof candidate.state === "string";
}

/** Short-lived read. A missing, partial or foreign file is `null`, never an exception. */
export async function readStatus(rootDir: string, jobId: string): Promise<JobStatus | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(jobPaths(rootDir, jobId).status, "utf8"));
    return isStatusShape(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export interface StatusWriter {
  /** Serialises the status as it is NOW and queues the write; writes never interleave. */
  write(status: JobStatus): Promise<void>;
}

interface QueuedWrite {
  text: string;
  done: Promise<void>;
}

/**
 * Writes are serialised, and a write still waiting for its turn is replaced by the newer text
 * instead of queueing behind it: the backlog never exceeds one pending write, however fast
 * heartbeats and progress updates arrive.
 */
export function createStatusWriter(rootDir: string, jobId: string): StatusWriter {
  let chain: Promise<void> = Promise.resolve();
  let queued: QueuedWrite | null = null;
  return {
    write(status) {
      const text = JSON.stringify(status, null, 2);
      if (queued !== null) {
        queued.text = text;
        return queued.done;
      }
      const entry: QueuedWrite = { text, done: Promise.resolve() };
      entry.done = chain.catch(() => undefined).then(() => {
        queued = null;
        return writeStatusAtomic(rootDir, jobId, entry.text);
      });
      queued = entry;
      chain = entry.done;
      return entry.done;
    },
  };
}
