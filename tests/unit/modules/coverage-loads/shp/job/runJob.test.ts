import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXIT_CODE } from "@/modules/coverage-loads/shp/job/constants.ts";
import type { JobSpawnConfig } from "@/modules/coverage-loads/shp/job/jobConfig.ts";
import { jobPaths, lockPath } from "@/modules/coverage-loads/shp/job/layout.ts";
import { acquireTableLock, readLock } from "@/modules/coverage-loads/shp/job/lock.ts";
import type { JobPipeline } from "@/modules/coverage-loads/shp/job/pipeline.ts";
import { createRealPipeline } from "@/modules/coverage-loads/shp/job/realPipeline.ts";
import { runJob } from "@/modules/coverage-loads/shp/job/runJob.ts";
import { readStatus } from "@/modules/coverage-loads/shp/job/statusFile.ts";
import {
  CANARY_CONNECTION,
  CANARY_DB,
  CANARY_HOST,
  CANARY_PASSWORD,
  CANARY_USER,
  createTmpRoots,
  exists,
  makeJob,
  sleepMs,
  waitFor,
} from "../helpers/jobTestEnv.ts";
import { createFakePg } from "../helpers/fakePg.ts";

vi.setConfig({ testTimeout: 30_000 });

const roots = createTmpRoots();
afterEach(() => roots.cleanup());

const FAST = { heartbeatMs: 10, cancelPollMs: 10, progressThrottleMs: 1 };

function configFor(jobId: string, overrides: Partial<JobSpawnConfig> = {}): JobSpawnConfig {
  return { jobId, mode: "LOAD", pipeline: "fake", fake: { stageMs: 10 }, connection: { ...CANARY_CONNECTION }, timing: FAST, ...overrides };
}

async function readAll(root: string, jobId: string): Promise<string> {
  const paths = jobPaths(root, jobId);
  const log = await readFile(paths.log, "utf8").catch(() => "");
  const status = await readFile(paths.status, "utf8").catch(() => "");
  return `${log}\n${status}`;
}

function expectNoSecrets(text: string): void {
  for (const secret of [CANARY_PASSWORD, CANARY_HOST, CANARY_USER, CANARY_DB]) expect(text).not.toContain(secret);
}

describe("runJob outcomes", () => {
  it("should succeed: exit 0, SUCCEEDED, source deleted, lock released, no secrets on disk", async () => {
    const root = await roots.create();
    const job = await makeJob(root);

    const code = await runJob(configFor(job.jobId), { rootDir: root, pid: 777, nodeVersion: "v24.test" });

    const status = await readStatus(root, job.jobId);
    expect(code).toBe(EXIT_CODE.SUCCEEDED);
    expect(status).toMatchObject({ state: "SUCCEEDED", pid: 777, nodeVersion: "v24.test", stage: null, error: null });
    expect(status?.gates?.passed).toBe(true);
    expect(await exists(jobPaths(root, job.jobId).source)).toBe(false);
    expect(await readLock(root, "lte")).toBeNull();
    expectNoSecrets(await readAll(root, job.jobId));
  });

  it("should finish TEST mode with SWAPPING skipped and a test report", async () => {
    const root = await roots.create();
    const job = await makeJob(root, { mode: "TEST" });

    const code = await runJob(configFor(job.jobId, { mode: "TEST" }), { rootDir: root });

    const status = await readStatus(root, job.jobId);
    expect(code).toBe(0);
    expect(status?.state).toBe("SUCCEEDED");
    expect(status?.stages.find((s) => s.id === "SWAPPING")?.state).toBe("SKIPPED");
    expect(status?.testReport).not.toBeNull();
  });

  it("should fail with exit 1, the failing stage and a code, still deleting source and releasing the lock", async () => {
    const root = await roots.create();
    const job = await makeJob(root);

    const code = await runJob(configFor(job.jobId, { fake: { stageMs: 10, failAtStage: "REPAIRING" } }), { rootDir: root });

    const status = await readStatus(root, job.jobId);
    expect(code).toBe(EXIT_CODE.FAILED);
    expect(status).toMatchObject({ state: "FAILED", error: { code: "FAKE_FAILURE", stage: "REPAIRING" } });
    expect(status?.stages.find((s) => s.id === "REPAIRING")?.state).toBe("FAILED");
    expect(await exists(jobPaths(root, job.jobId).source)).toBe(false);
    expect(await readLock(root, "lte")).toBeNull();
  });

  it("should cancel mid-run: exit 2, CANCELLED, source gone, lock released", async () => {
    const root = await roots.create();
    const job = await makeJob(root);
    const run = runJob(configFor(job.jobId, { fake: { stageMs: 2000 } }), { rootDir: root });
    await waitFor(async () => (await readStatus(root, job.jobId))?.stage === "READING");

    await writeFile(jobPaths(root, job.jobId).cancel, "");
    const code = await run;

    const status = await readStatus(root, job.jobId);
    expect(code).toBe(EXIT_CODE.CANCELLED);
    expect(status).toMatchObject({ state: "CANCELLED", cancelRequested: true });
    expect(await exists(jobPaths(root, job.jobId).source)).toBe(false);
    expect(await readLock(root, "lte")).toBeNull();
  });

  it("should end a held statement through the cancel hook without waiting for the grace", async () => {
    const root = await roots.create();
    const job = await makeJob(root);
    const run = runJob(configFor(job.jobId, { fake: { stageMs: { STAGING: 60_000, READING: 5 }, holdStage: "STAGING" }, timing: { ...FAST, hardKillGraceMs: 60_000 } }), { rootDir: root });
    await waitFor(async () => (await readStatus(root, job.jobId))?.stage === "STAGING");

    await writeFile(jobPaths(root, job.jobId).cancel, "");
    const code = await run;

    expect(code).toBe(EXIT_CODE.CANCELLED);
  }, 30_000);

  it("should finalise a hung pipeline as CANCELLED with exit 2 after the grace period", async () => {
    const root = await roots.create();
    const job = await makeJob(root);
    const hung: JobPipeline = { run: () => new Promise(() => undefined) };
    const run = runJob(configFor(job.jobId, { timing: { ...FAST, hardKillGraceMs: 150 } }), { rootDir: root, pipeline: hung });
    await waitFor(async () => (await readStatus(root, job.jobId))?.state === "RUNNING");

    const cancelAt = Date.now();
    await writeFile(jobPaths(root, job.jobId).cancel, "");
    const code = await run;

    expect(code).toBe(EXIT_CODE.CANCELLED);
    expect(Date.now() - cancelAt).toBeGreaterThanOrEqual(100);
    expect((await readStatus(root, job.jobId))?.state).toBe("CANCELLED");
    expect(await readLock(root, "lte")).toBeNull();
    expect(await exists(jobPaths(root, job.jobId).source)).toBe(false);
  });

  it("should treat a pipeline that fails after a cancel was requested as CANCELLED", async () => {
    const root = await roots.create();
    const job = await makeJob(root);
    const pipeline: JobPipeline = {
      run: async (context) => {
        await new Promise<void>((resolve) => context.signal.addEventListener("abort", () => resolve(), { once: true }));
        return { kind: "FAILED", error: { code: "ABORTED", message: "statement canceled" } };
      },
    };
    const run = runJob(configFor(job.jobId), { rootDir: root, pipeline });
    await waitFor(async () => (await readStatus(root, job.jobId))?.state === "RUNNING");

    await writeFile(jobPaths(root, job.jobId).cancel, "");

    expect(await run).toBe(EXIT_CODE.CANCELLED);
  });

  it("should map a throwing pipeline to FAILED/PIPELINE_ERROR with a scrubbed message", async () => {
    const root = await roots.create();
    const job = await makeJob(root);
    const pipeline: JobPipeline = { run: () => Promise.reject(new Error(`connect to ${CANARY_HOST} as ${CANARY_USER} with ${CANARY_PASSWORD} failed`)) };

    const code = await runJob(configFor(job.jobId), { rootDir: root, pipeline });

    const status = await readStatus(root, job.jobId);
    expect(code).toBe(EXIT_CODE.FAILED);
    expect(status?.error?.code).toBe("PIPELINE_ERROR");
    expect(status?.error?.message).toBe("connect to *** as *** with *** failed");
    expectNoSecrets(await readAll(root, job.jobId));
  });

  it("should map a synchronously throwing pipeline to FAILED too", async () => {
    const root = await roots.create();
    const job = await makeJob(root);
    const pipeline: JobPipeline = {
      run: () => {
        throw new Error("sync boom");
      },
    };

    expect(await runJob(configFor(job.jobId), { rootDir: root, pipeline })).toBe(EXIT_CODE.FAILED);
    expect((await readStatus(root, job.jobId))?.error?.message).toBe("sync boom");
  });

  it("should scrub extra secretsToScrub from a failure message", async () => {
    const root = await roots.create();
    const job = await makeJob(root);
    const pipeline: JobPipeline = { run: () => Promise.reject(new Error("token EXTRA-SECRET leaked")) };

    await runJob(configFor(job.jobId, { secretsToScrub: ["EXTRA-SECRET"] }), { rootDir: root, pipeline });

    expect((await readStatus(root, job.jobId))?.error?.message).toBe("token *** leaked");
  });

  it("should run an injected real pipeline whose connection fails to FAILED without leaking any secret to disk", async () => {
    const root = await roots.create();
    const job = await makeJob(root);
    const fake = createFakePg();
    fake.connectError = new Error(`password authentication failed for ${CANARY_USER} using ${CANARY_PASSWORD} at ${CANARY_HOST}`);
    const pipeline = createRealPipeline({ clientFactory: fake.factory, copyIn: fake.copyIn });

    const code = await runJob(configFor(job.jobId, { pipeline: "real", fake: undefined }), { rootDir: root, pipeline });

    expect(code).toBe(EXIT_CODE.FAILED);
    expect((await readStatus(root, job.jobId))?.error?.code).toBe("DB_CONNECT_FAILED");
    expectNoSecrets(await readAll(root, job.jobId));
  });
});

describe("runJob table lock", () => {
  it("should fail with TABLE_LOCKED and leave the other job's lock alone when the table is busy", async () => {
    const root = await roots.create();
    const owner = await makeJob(root, { state: "RUNNING", mutate: (s) => ((s.pid = process.pid), (s.heartbeatAt = new Date().toISOString())) });
    await acquireTableLock(root, "lte", { jobId: owner.jobId, pid: process.pid });
    const job = await makeJob(root);

    const code = await runJob(configFor(job.jobId), { rootDir: root });

    const status = await readStatus(root, job.jobId);
    expect(code).toBe(EXIT_CODE.FAILED);
    expect(status?.error?.code).toBe("TABLE_LOCKED");
    expect(status?.error?.message).toContain("lte");
    expect((await readLock(root, "lte"))?.jobId).toBe(owner.jobId);
  });

  it("should hold the lock while running and own it under the job's pid", async () => {
    const root = await roots.create();
    const job = await makeJob(root);
    const run = runJob(configFor(job.jobId, { fake: { stageMs: 300 } }), { rootDir: root, pid: 4242 });

    await waitFor(async () => (await readLock(root, "lte")) !== null);

    expect(await readLock(root, "lte")).toMatchObject({ jobId: job.jobId, pid: 4242 });
    await run;
    expect(await exists(lockPath(root, "lte"))).toBe(false);
  });
});

describe("runJob refusing to start (exit 3, nothing written)", () => {
  async function snapshot(root: string, jobId: string): Promise<string[]> {
    return readdir(jobPaths(root, jobId).dir).catch(() => ["<none>"]);
  }

  it("should exit 3 when the status is missing", async () => {
    const root = await roots.create();

    expect(await runJob(configFor("123e4567-e89b-42d3-a456-426614174000"), { rootDir: root })).toBe(EXIT_CODE.BAD_CONFIG);
    expect(await readdir(root)).toEqual([]);
  });

  it.each(["UPLOADING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLING"] as const)("should exit 3 when the status is %s, not READY", async (state) => {
    const root = await roots.create();
    const job = await makeJob(root, { state });
    const before = await readFile(jobPaths(root, job.jobId).status, "utf8");

    expect(await runJob(configFor(job.jobId), { rootDir: root })).toBe(EXIT_CODE.BAD_CONFIG);

    expect(await readFile(jobPaths(root, job.jobId).status, "utf8")).toBe(before);
    expect(await exists(jobPaths(root, job.jobId).log)).toBe(false);
    expect(await readLock(root, "lte")).toBeNull();
  });

  it("should exit 3 on a mode mismatch and write nothing", async () => {
    const root = await roots.create();
    const job = await makeJob(root, { mode: "LOAD" });
    const filesBefore = await snapshot(root, job.jobId);

    expect(await runJob(configFor(job.jobId, { mode: "TEST" }), { rootDir: root })).toBe(EXIT_CODE.BAD_CONFIG);

    expect(await snapshot(root, job.jobId)).toEqual(filesBefore);
    expect((await readStatus(root, job.jobId))?.state).toBe("READY");
    expect(await exists(jobPaths(root, job.jobId).source)).toBe(true);
    expect(await exists(path.join(root, "locks"))).toBe(false);
  });
});

describe("runJob timers", () => {
  it("should not leave heartbeats running after it returns", async () => {
    const root = await roots.create();
    const job = await makeJob(root);
    await runJob(configFor(job.jobId), { rootDir: root });
    const after = (await readStatus(root, job.jobId))?.heartbeatAt;

    await sleepMs(80);

    expect((await readStatus(root, job.jobId))?.heartbeatAt).toBe(after);
  });
});
