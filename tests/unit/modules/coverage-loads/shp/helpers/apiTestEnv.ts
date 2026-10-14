import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createShpHandlers } from "@/modules/coverage-loads/shp/api/handlers";
import type { ShpHandlerDependencies } from "@/modules/coverage-loads/shp/services/shpContext";
import type { ShpPlanRepository } from "@/modules/coverage-loads/shp/services/ShpPlanRepository";
import type { ChildLike, SpawnProcessFn } from "@/modules/coverage-loads/shp/services/spawnTypes";
import { jobPaths } from "@/modules/coverage-loads/shp/job/layout.ts";
import { writeStatusAtomic } from "@/modules/coverage-loads/shp/job/statusFile.ts";
import { createInitialStatus } from "@/modules/coverage-loads/shp/job/statusTransitions.ts";
import { JOB_MODE, JOB_STATE } from "@/modules/coverage-loads/shp/job/types.ts";
import type { JobMode, JobState, JobStatus, ShpPrefix, ShpTable } from "@/modules/coverage-loads/shp/job/types.ts";
import type { DbConnection } from "@/modules/coverage-loads/types";
import type { ShpDbInspection } from "@/modules/coverage-loads/shp/types";

export const CANARY_PASSWORD = "PASSWORD-CANARY-12345";

export const CONNECTION_BODY = { host: "db.internal.example", port: 5432, db_name: "gisdb", user: "gisuser", password: CANARY_PASSWORD };

const TABLE_PREFIX: Record<ShpTable, ShpPrefix> = {
  cobertura5g: "NRUruguay",
  wcdma: "WCDMAUruguay",
  nbiot: "NBIoTUruguay",
  lte: "LTEUruguay",
};

export const FIXED_NOW = Date.parse("2026-03-10T12:00:00.000Z");
export const MISSING_JOB_ID = "00000000-0000-4000-8000-000000000000";
const API_URL = "http://localhost/api/m/coverage-loads/shp";

/** Tracks temp roots under os.tmpdir() and removes them all in `cleanup` (call from afterEach). */
export function createTmpRoots() {
  const roots: string[] = [];
  return {
    async create(): Promise<string> {
      const root = await mkdtemp(path.join(os.tmpdir(), "shp-api-test-"));
      roots.push(root);
      return root;
    },
    async cleanup(): Promise<void> {
      const pending = roots.splice(0);
      await Promise.all(pending.map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));
    },
  };
}

export const HEALTHY_INSPECTION: ShpDbInspection = {
  tableExists: true,
  missingTablePrivileges: [],
  schemaCreateGranted: true,
  postgisAvailable: true,
  leftovers: [],
  advisoryLockHeld: false,
  currentRows: 42,
};

/** Read-only fake of the plan repository; records every call so a test can assert on them. */
export class FakeRepository implements ShpPlanRepository {
  readonly calls: Array<{ connection: DbConnection; table: ShpTable }> = [];
  inspection: ShpDbInspection = HEALTHY_INSPECTION;
  failure: Error | null = null;
  /** Runs after a microtask tick, once the caller's synchronous work has happened. */
  onInspect: (() => void) | null = null;

  async inspect(connection: DbConnection, table: ShpTable): Promise<ShpDbInspection> {
    this.calls.push({ connection, table });
    await Promise.resolve();
    this.onInspect?.();
    if (this.failure !== null) throw this.failure;
    return this.inspection;
  }
}

export interface FakeChild extends ChildLike {
  readonly stdinWrites: string[];
  stdinEnded: number;
  unrefCalls: number;
  emit(event: "error" | "exit", value?: unknown): void;
}

export interface SpawnCall {
  command: string;
  args: string[];
  options: Record<string, unknown>;
  child: FakeChild;
  /** Filesystem facts observed at the moment spawn was called. */
  observed: { lockExists: boolean; statusMode: string | null };
}

function createFakeChild(pid: number | undefined): FakeChild {
  const listeners: Record<string, Array<(value?: unknown) => void>> = {};
  const child: FakeChild = {
    pid,
    stdinWrites: [],
    stdinEnded: 0,
    unrefCalls: 0,
    stdin: {
      write(chunk: string) {
        child.stdinWrites.push(chunk);
        return true;
      },
      end() {
        child.stdinEnded += 1;
      },
      on() {
        return undefined;
      },
    },
    unref() {
      child.unrefCalls += 1;
    },
    once(event: string, listener: (value?: unknown) => void) {
      (listeners[event] ??= []).push(listener);
      return child;
    },
    emit(event, value) {
      for (const listener of listeners[event] ?? []) listener(value);
    },
  } as FakeChild;
  return child;
}

export interface FakeSpawn {
  readonly fn: SpawnProcessFn;
  readonly calls: SpawnCall[];
}

/** A spawn that never starts anything. `behaviour` lets a test make it throw or return a pid-less child. */
export function createFakeSpawn(
  rootDir: string,
  options: { pid?: number | undefined; throws?: Error } = {}
): FakeSpawn {
  const calls: SpawnCall[] = [];
  const fn: SpawnProcessFn = (command, args, spawnOptions) => {
    if (options.throws) throw options.throws;
    const child = createFakeChild("pid" in options ? options.pid : 4242);
    const cwd = String(spawnOptions.cwd);
    const statusPath = path.join(cwd, "status.json");
    const observed = {
      lockExists: readdirSync(path.join(rootDir, "locks")).length > 0,
      statusMode: existsSync(statusPath) ? (JSON.parse(readFileSync(statusPath, "utf8")) as JobStatus).mode : null,
    };
    const call: SpawnCall = { command, args, options: spawnOptions as Record<string, unknown>, child, observed };
    calls.push(call);
    return child;
  };
  return { fn, calls };
}

export interface Harness {
  readonly root: string;
  readonly repository: FakeRepository;
  readonly spawn: FakeSpawn;
  readonly handlers: ReturnType<typeof createShpHandlers>;
  readonly clock: { now: number };
  readonly alivePids: Set<number>;
  readonly killed: number[];
}

export interface HarnessOptions extends Partial<ShpHandlerDependencies> {
  spawnPid?: number | undefined;
  spawnThrows?: Error;
}

export function createHarness(root: string, options: HarnessOptions = {}): Harness {
  const repository = new FakeRepository();
  const spawn = createFakeSpawn(root, {
    ...("spawnPid" in options ? { pid: options.spawnPid } : {}),
    ...(options.spawnThrows ? { throws: options.spawnThrows } : {}),
  });
  const clock = { now: FIXED_NOW };
  const alivePids = new Set<number>();
  const killed: number[] = [];
  const handlers = createShpHandlers({
    rootDir: root,
    repository,
    spawnProcess: spawn.fn,
    pipelineMode: "real",
    now: () => clock.now,
    isPidAlive: (pid) => alivePids.has(pid),
    killProcess: (pid) => {
      killed.push(pid);
    },
    freeBytes: async () => Number.MAX_SAFE_INTEGER,
    ...options,
  });
  return { root, repository, spawn, handlers, clock, alivePids, killed };
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

/** Creates `jobs/<id>/status.json` (plus a dummy source.shp) under `root`. */
export async function makeJob(root: string, options: MakeJobOptions = {}): Promise<{ jobId: string; status: JobStatus }> {
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
    now: options.now ?? FIXED_NOW,
    state: options.state ?? JOB_STATE.READY,
  });
  options.mutate?.(status);
  const paths = jobPaths(root, jobId);
  await mkdir(paths.dir, { recursive: true });
  if (options.source !== false) await writeFile(paths.source, "x");
  await writeStatusAtomic(root, jobId, JSON.stringify(status, null, 2));
  return { jobId, status };
}

export function jsonPost(name: string, body: unknown): Request {
  return new Request(`${API_URL}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function getRequest(name: string, query: Record<string, string> = {}): Request {
  const url = new URL(`${API_URL}/${name}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return new Request(url, { method: "GET" });
}

/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted field by field in tests */
export async function readJson(response: Response): Promise<Record<string, any>> {
  return (await response.json()) as Record<string, any>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false
  );
}

export async function readStatusFile(root: string, jobId: string): Promise<JobStatus> {
  return JSON.parse(await readFile(jobPaths(root, jobId).status, "utf8")) as JobStatus;
}

export async function listJobDirs(root: string): Promise<string[]> {
  return readdir(path.join(root, "jobs")).catch(() => [] as string[]);
}

export async function readAllText(root: string): Promise<string> {
  const chunks: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (!/\.shp$|\.part$/.test(entry.name)) chunks.push(await readFile(full, "utf8"));
    }
  }
  await walk(root);
  return chunks.join("\n");
}

export function uploadRequest(options: {
  fileName?: string | null;
  size?: string | number | null;
  body?: ReadableStream<Uint8Array> | Uint8Array | null;
  contentType?: string | null;
  signal?: AbortSignal;
}): Request {
  const headers = new Headers();
  if (options.contentType !== null) headers.set("content-type", options.contentType ?? "application/octet-stream");
  if (options.fileName !== null) headers.set("x-file-name", encodeURIComponent(options.fileName ?? "LTEUruguay_20260131.shp"));
  if (options.size !== null && options.size !== undefined) headers.set("x-file-size", String(options.size));
  const body = options.body === undefined ? new Uint8Array([1, 2, 3]) : options.body;
  return new Request(`${API_URL}/upload`, {
    method: "POST",
    headers,
    body: body as BodyInit | null,
    // Required by undici for a streamed request body.
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  } as RequestInit);
}

/** A ReadableStream that pulls its chunks lazily and counts how many were pulled. */
export function countingStream(chunkCount: number, chunkBytes: number, options: { onPull?: (pulled: number) => void; abortAfter?: { chunks: number; controller: AbortController } } = {}) {
  const state = { pulled: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled >= chunkCount) {
        controller.close();
        return;
      }
      state.pulled += 1;
      controller.enqueue(new Uint8Array(chunkBytes).fill(7));
      options.onPull?.(state.pulled);
      if (options.abortAfter && state.pulled === options.abortAfter.chunks) options.abortAfter.controller.abort();
    },
  });
  return { stream, state };
}

export async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("waitFor timed out");
}

export async function readLockFile(root: string, table: ShpTable): Promise<{ jobId: string; pid: number } | null> {
  try {
    return JSON.parse(await readFile(path.join(root, "locks", `${table}.json`), "utf8")) as { jobId: string; pid: number };
  } catch {
    return null;
  }
}
