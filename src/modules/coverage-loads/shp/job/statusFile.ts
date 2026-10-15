import { readFile, rename, writeFile } from "node:fs/promises";
import {
  STATUS_DURABLE_BACKOFF_CAP_MS,
  STATUS_DURABLE_BACKOFF_START_MS,
  STATUS_DURABLE_BUDGET_MS,
  STATUS_READ_BACKOFF_MS,
  STATUS_READ_RETRIES,
  STATUS_RENAME_BACKOFF_MS,
  STATUS_RENAME_RETRIES,
} from "./constants.ts";
import { jobPaths } from "./layout.ts";
import { SCHEMA_VERSION } from "./types.ts";
import type { JobStatus } from "./types.ts";

const RETRYABLE_CODES = ["EPERM", "EBUSY", "EACCES"];
const RETRYABLE_RENAME_ONLY_CODES = ["ENOENT"];
const MIN_JITTER = 0.5;

export interface StatusWriteOptions {
  /**
   * The write must not be lost (state changes, terminal states): retried for a long budget with
   * capped exponential backoff. Without it the write is skippable (heartbeat, progress) and uses
   * the short budget, because the next write supersedes it.
   */
  durable?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorCode(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" ? code : undefined;
}

function isRetryable(error: unknown, extra: readonly string[] = []): boolean {
  const code = errorCode(error);
  return code !== undefined && (RETRYABLE_CODES.includes(code) || extra.includes(code));
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      // Windows refuses to replace a file a reader has open; the reader's handle is short-lived.
      if (!isRetryable(error) || attempt >= STATUS_RENAME_RETRIES) throw error;
      await sleep(STATUS_RENAME_BACKOFF_MS * (attempt + 1));
    }
  }
}

function durableDelayMs(attempt: number): number {
  const ceiling = Math.min(STATUS_DURABLE_BACKOFF_CAP_MS, STATUS_DURABLE_BACKOFF_START_MS * 2 ** attempt);
  return Math.round(ceiling * (MIN_JITTER + Math.random() * (1 - MIN_JITTER)));
}

/** Retries the whole tmp write + rename (a vanished tmp is rewritten) until the budget is spent. */
async function writeDurably(tmp: string, target: string, text: string): Promise<void> {
  const deadline = Date.now() + STATUS_DURABLE_BUDGET_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await writeFile(tmp, text, "utf8");
      await rename(tmp, target);
      return;
    } catch (error) {
      if (!isRetryable(error, RETRYABLE_RENAME_ONLY_CODES) || Date.now() >= deadline) throw error;
      await sleep(Math.min(durableDelayMs(attempt), Math.max(0, deadline - Date.now())));
    }
  }
}

/** Writes `status.json.tmp` then renames it over `status.json`, so a reader never sees half a file. */
export async function writeStatusAtomic(rootDir: string, jobId: string, text: string, options: StatusWriteOptions = {}): Promise<void> {
  const paths = jobPaths(rootDir, jobId);
  if (options.durable) return writeDurably(paths.statusTmp, paths.status, text);
  await writeFile(paths.statusTmp, text, "utf8");
  await renameWithRetry(paths.statusTmp, paths.status);
}

function isStatusShape(value: unknown): value is JobStatus {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<JobStatus>;
  return candidate.schemaVersion === SCHEMA_VERSION && typeof candidate.jobId === "string" && typeof candidate.state === "string";
}

/** Reads the file, retrying briefly while Windows reports it locked (EPERM/EBUSY/EACCES); ENOENT is final. */
async function readStatusText(file: string): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await readFile(file, "utf8");
    } catch (error) {
      if (!isRetryable(error) || attempt >= STATUS_READ_RETRIES) throw error;
      await sleep(STATUS_READ_BACKOFF_MS);
    }
  }
}

/** Short-lived read. A missing, partial or foreign file is `null`, never an exception. */
export async function readStatus(rootDir: string, jobId: string): Promise<JobStatus | null> {
  try {
    const parsed: unknown = JSON.parse(await readStatusText(jobPaths(rootDir, jobId).status));
    return isStatusShape(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export interface StatusWriter {
  /** Serialises the status as it is NOW and queues the write; writes never interleave. */
  write(status: JobStatus, options?: StatusWriteOptions): Promise<void>;
}

interface QueuedWrite {
  text: string;
  durable: boolean;
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
    write(status, options = {}) {
      const text = JSON.stringify(status, null, 2);
      if (queued !== null) {
        queued.text = text;
        queued.durable ||= options.durable === true;
        return queued.done;
      }
      const entry: QueuedWrite = { text, durable: options.durable === true, done: Promise.resolve() };
      entry.done = chain.catch(() => undefined).then(() => {
        queued = null;
        return writeStatusAtomic(rootDir, jobId, entry.text, { durable: entry.durable });
      });
      queued = entry;
      chain = entry.done;
      return entry.done;
    },
  };
}
