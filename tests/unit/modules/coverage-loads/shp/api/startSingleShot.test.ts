import { mkdirSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jobPaths } from "@/modules/coverage-loads/shp/job/layout.ts";
import { createShpHandlers } from "@/modules/coverage-loads/shp/api/handlers";
import {
  CONNECTION_BODY,
  createFakeSpawn,
  createHarness,
  createTmpRoots,
  exists,
  FakeRepository,
  FIXED_NOW,
  jsonPost,
  makeJob,
  readJson,
  readLockFile,
  readStatusFile,
} from "../helpers/apiTestEnv";

vi.setConfig({ testTimeout: 30_000 });

const roots = createTmpRoots();
afterEach(() => roots.cleanup());

const ALREADY_STARTED = "Esta carga ya fue iniciada.";
const REFUSED_BY_PLAN = "La carga no puede iniciarse: revise los bloqueos y privilegios del plan.";

function startBody(jobId: string, overrides: Record<string, unknown> = {}) {
  return { jobId, mode: "LOAD", confirm: true, connection: CONNECTION_BODY, ...overrides };
}

/** Handlers whose plan check runs `afterInspect` once, i.e. between the plan check and startJob. */
function harnessWithRaceHook(root: string, afterInspect: () => void) {
  const repository = new FakeRepository();
  const spawn = createFakeSpawn(root);
  repository.onInspect = () => {
    afterInspect();
  };
  const handlers = createShpHandlers({
    rootDir: root,
    repository,
    spawnProcess: spawn.fn,
    pipelineMode: "real",
    now: () => FIXED_NOW,
    isPidAlive: () => false,
    killProcess: () => undefined,
    freeBytes: async () => Number.MAX_SAFE_INTEGER,
  });
  return { handlers, spawn };
}

describe("POST shp/start single-shot", () => {
  it("should spawn exactly once and answer 200 once when two starts of the same job run concurrently", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);

    // Act
    const responses = await Promise.all([
      harness.handlers.start(jsonPost("start", startBody(jobId))),
      harness.handlers.start(jsonPost("start", startBody(jobId))),
    ]);

    // Assert
    expect(harness.spawn.calls).toHaveLength(1);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const refused = responses.find((response) => response.status === 409) as Response;
    expect([ALREADY_STARTED, REFUSED_BY_PLAN]).toContain((await readJson(refused)).error);
  });

  it("should spawn exactly once when many starts of the same job run concurrently", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);

    // Act
    const responses = await Promise.all(Array.from({ length: 6 }, () => harness.handlers.start(jsonPost("start", startBody(jobId)))));

    // Assert
    expect(harness.spawn.calls).toHaveLength(1);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(5);
  });

  it("should answer 409, spawn nothing more and keep the marker on a repeated start after the first one succeeded", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);
    await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Act
    const second = await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Assert
    expect(second.status).toBe(409);
    expect(harness.spawn.calls).toHaveLength(1);
    expect(await exists(jobPaths(harness.root, jobId).startLock)).toBe(true);
  });

  it("should refuse with 409 and spawn nothing when a start.lock already exists, without taking the table lock", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);
    await writeFile(jobPaths(harness.root, jobId).startLock, "earlier-start");

    // Act
    const response = await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Assert
    expect(response.status).toBe(409);
    expect((await readJson(response)).error).toBe(ALREADY_STARTED);
    expect(harness.spawn.calls).toEqual([]);
    expect(await readLockFile(harness.root, "lte")).toBeNull();
    expect(await readFile(jobPaths(harness.root, jobId).startLock, "utf8")).toBe("earlier-start");
    expect((await readStatusFile(harness.root, jobId)).state).toBe("READY");
  });

  it("should leave the start.lock in place after a successful start", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);

    // Act
    const response = await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Assert
    expect(response.status).toBe(200);
    expect(await exists(jobPaths(harness.root, jobId).startLock)).toBe(true);
  });

  it("should release the start.lock when another job holds the table lock so a later start can be tried", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const holder = await makeJob(harness.root, { table: "lte" });
    mkdirSync(path.join(harness.root, "locks"), { recursive: true });
    writeFileSync(path.join(harness.root, "locks", "lte.json"), JSON.stringify({ table: "lte", jobId: holder.jobId, pid: process.pid, acquiredAt: "x" }));
    const { jobId } = await makeJob(harness.root, { table: "lte" });

    // Act
    const response = await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Assert
    expect(response.status).toBe(409);
    expect(await exists(jobPaths(harness.root, jobId).startLock)).toBe(false);
    expect((await readLockFile(harness.root, "lte"))?.jobId).toBe(holder.jobId);
  });
});

describe("POST shp/start re-reads the status after taking the table lock", () => {
  it("should answer 409 NOT_READY, spawn nothing and write nothing when the job became RUNNING after the plan check", async () => {
    // Arrange
    const root = await roots.create();
    const { jobId, status } = await makeJob(root, { mode: "LOAD" });
    const running = { ...status, state: "RUNNING" as const, pid: 4321 };
    const { handlers, spawn } = harnessWithRaceHook(root, () => writeFileSync(jobPaths(root, jobId).status, JSON.stringify(running, null, 2)));

    // Act
    const response = await handlers.start(jsonPost("start", startBody(jobId, { mode: "TEST" })));

    // Assert
    expect(response.status).toBe(409);
    expect((await readJson(response)).error).toContain("RUNNING");
    expect(spawn.calls).toEqual([]);
    const after = await readStatusFile(root, jobId);
    expect(after.state).toBe("RUNNING");
    expect(after.mode).toBe("LOAD");
    expect(after.pid).toBe(4321);
  });

  it("should free the table lock and the marker when the job turned terminal after the plan check", async () => {
    // Arrange
    const root = await roots.create();
    const { jobId, status } = await makeJob(root);
    const cancelled = { ...status, state: "CANCELLED" as const };
    const { handlers, spawn } = harnessWithRaceHook(root, () => writeFileSync(jobPaths(root, jobId).status, JSON.stringify(cancelled, null, 2)));

    // Act
    const response = await handlers.start(jsonPost("start", startBody(jobId)));

    // Assert
    expect(response.status).toBe(409);
    expect((await readJson(response)).error).toContain("CANCELLED");
    expect(spawn.calls).toEqual([]);
    expect(await readLockFile(root, "lte")).toBeNull();
    expect(await exists(jobPaths(root, jobId).startLock)).toBe(false);
  });

  it("should answer 409 and free everything when the status disappeared after the plan check", async () => {
    // Arrange
    const root = await roots.create();
    const { jobId } = await makeJob(root);
    const { handlers, spawn } = harnessWithRaceHook(root, () => writeFileSync(jobPaths(root, jobId).status, "{broken"));

    // Act
    const response = await handlers.start(jsonPost("start", startBody(jobId)));

    // Assert
    expect(response.status).toBe(409);
    expect(spawn.calls).toEqual([]);
    expect(await readLockFile(root, "lte")).toBeNull();
    expect(await exists(jobPaths(root, jobId).startLock)).toBe(false);
  });

  it("should write the fresh status (not the plan-time snapshot) plus the requested mode before spawning", async () => {
    // Arrange
    const root = await roots.create();
    const { jobId, status } = await makeJob(root, { mode: "LOAD" });
    const touched = { ...status, progress: { ...status.progress, rowsCopied: 5 } };
    const { handlers, spawn } = harnessWithRaceHook(root, () => writeFileSync(jobPaths(root, jobId).status, JSON.stringify(touched, null, 2)));

    // Act
    const response = await handlers.start(jsonPost("start", startBody(jobId, { mode: "TEST" })));

    // Assert
    expect(response.status).toBe(200);
    expect(spawn.calls).toHaveLength(1);
    expect(spawn.calls[0].observed.statusMode).toBe("TEST");
    const after = await readStatusFile(root, jobId);
    expect(after.progress.rowsCopied).toBe(5);
    expect(after.mode).toBe("TEST");
    expect(after.state).toBe("READY");
  });
});

describe("POST shp/start spawn failure cleanup", () => {
  it("should remove the start.lock, release the table lock and leave the job FAILED when spawn throws", async () => {
    // Arrange
    const harness = createHarness(await roots.create(), { spawnThrows: new Error("EAGAIN") });
    const { jobId } = await makeJob(harness.root);

    // Act
    const response = await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Assert
    expect(response.status).toBe(500);
    expect(await exists(jobPaths(harness.root, jobId).startLock)).toBe(false);
    expect(await readLockFile(harness.root, "lte")).toBeNull();
    const status = await readStatusFile(harness.root, jobId);
    expect(status.state).toBe("FAILED");
    expect(status.error?.code).toBe("SPAWN_FAILED");
  });

  it("should remove the start.lock when the child has no pid", async () => {
    // Arrange
    const harness = createHarness(await roots.create(), { spawnPid: undefined });
    const { jobId } = await makeJob(harness.root);

    // Act
    const response = await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Assert
    expect(response.status).toBe(500);
    expect(await exists(jobPaths(harness.root, jobId).startLock)).toBe(false);
    expect(await readLockFile(harness.root, "lte")).toBeNull();
  });

  it("should refuse a retry of a spawn-failed job because it is no longer READY", async () => {
    // Arrange
    const harness = createHarness(await roots.create(), { spawnThrows: new Error("EAGAIN") });
    const { jobId } = await makeJob(harness.root);
    await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Act
    const retry = await harness.handlers.start(jsonPost("start", startBody(jobId)));

    // Assert
    expect(retry.status).toBe(409);
    expect((await readJson(retry)).error).toContain("FAILED");
  });
});
