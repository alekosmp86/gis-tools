import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { jobPaths } from "@/modules/coverage-loads/shp/job/layout.ts";
import { writeStatusAtomic } from "@/modules/coverage-loads/shp/job/statusFile.ts";
import { createInitialStatus } from "@/modules/coverage-loads/shp/job/statusTransitions.ts";
import { JOB_MODE, JOB_STATE } from "@/modules/coverage-loads/shp/job/types.ts";
import type { JobMode, JobState, JobStatus, ShpPrefix, ShpTable } from "@/modules/coverage-loads/shp/job/types.ts";

export const CANARY_PASSWORD = "PASSWORD-CANARY-12345";
export const CANARY_HOST = "db.internal.example";
export const CANARY_USER = "gisuser";
export const CANARY_DB = "gisdb-canary";

export const CANARY_CONNECTION = {
  host: CANARY_HOST,
  port: 5432,
  db_name: CANARY_DB,
  user: CANARY_USER,
  password: CANARY_PASSWORD,
};

const TABLE_PREFIX: Record<ShpTable, ShpPrefix> = {
  cobertura5g: "NRUruguay",
  wcdma: "WCDMAUruguay",
  nbiot: "NBIoTUruguay",
  lte: "LTEUruguay",
};

export interface TmpRoots {
  create(): Promise<string>;
  cleanup(): Promise<void>;
}

/** Tracks temp roots under os.tmpdir() and removes them all in `cleanup` (call from afterEach). */
export function createTmpRoots(): TmpRoots {
  const roots: string[] = [];
  return {
    async create() {
      const root = await mkdtemp(path.join(os.tmpdir(), "shp-job-test-"));
      roots.push(root);
      return root;
    },
    async cleanup() {
      const pending = roots.splice(0);
      await Promise.all(pending.map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));
    },
  };
}

export interface MakeJobOptions {
  jobId?: string;
  state?: JobState;
  mode?: JobMode;
  table?: ShpTable;
  now?: number;
  source?: boolean;
  mutate?: (status: JobStatus) => void;
}

export interface MadeJob {
  jobId: string;
  status: JobStatus;
}

/** Creates `jobs/<id>/status.json` (and a dummy source.shp) under `root`. */
export async function makeJob(root: string, options: MakeJobOptions = {}): Promise<MadeJob> {
  const jobId = options.jobId ?? randomUUID();
  const table = options.table ?? "lte";
  const status = createInitialStatus({
    jobId,
    mode: options.mode ?? JOB_MODE.LOAD,
    table,
    prefix: TABLE_PREFIX[table],
    fechaact: "2026-01-31",
    fileName: `${TABLE_PREFIX[table]}_20260131.shp`,
    sizeBytes: 1,
    receivedBytes: 1,
    now: options.now ?? Date.now(),
    state: options.state ?? JOB_STATE.READY,
  });
  options.mutate?.(status);
  const paths = jobPaths(root, jobId);
  await mkdir(paths.dir, { recursive: true });
  if (options.source !== false) await writeFile(paths.source, "x");
  await writeStatusAtomic(root, jobId, JSON.stringify(status, null, 2));
  return { jobId, status };
}

export async function exists(file: string): Promise<boolean> {
  return readFile(file).then(
    () => true,
    () => false
  );
}

export async function dirExists(dir: string): Promise<boolean> {
  return readdir(dir).then(
    () => true,
    () => false
  );
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs = 10_000, stepMs = 15): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleepMs(stepMs);
  }
  throw new Error("waitFor timed out");
}
