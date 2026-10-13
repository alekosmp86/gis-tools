import { readFile, stat, utimes, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { acquireTableLock } from "@/modules/coverage-loads/shp/job/lock.ts";
import { jobPaths } from "@/modules/coverage-loads/shp/job/layout.ts";
import {
  createHarness,
  createTmpRoots,
  exists,
  FIXED_NOW,
  jsonPost,
  makeJob,
  MISSING_JOB_ID,
  readJson,
  readLockFile,
  readStatusFile,
} from "../helpers/apiTestEnv";

const roots = createTmpRoots();
afterEach(() => roots.cleanup());

describe("POST shp/cancel", () => {
  it("should cancel a READY job at once: CANCELLED, source removed, lock released", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root);
    await acquireTableLock(harness.root, "lte", { jobId, pid: process.pid }, { now: () => FIXED_NOW });

    // Act
    const response = await harness.handlers.cancel(jsonPost("cancel", { jobId }));

    // Assert
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ success: true, jobId, outcome: "CANCELLED" });
    const status = await readStatusFile(harness.root, jobId);
    expect(status.state).toBe("CANCELLED");
    expect(status.cancelRequested).toBe(true);
    expect(await exists(jobPaths(harness.root, jobId).source)).toBe(false);
    expect(await readLockFile(harness.root, "lte")).toBeNull();
    expect(await exists(jobPaths(harness.root, jobId).cancel)).toBe(false);
  });

  it("should leave a lock owned by another job untouched when cancelling a READY job", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const holder = await makeJob(harness.root);
    await acquireTableLock(harness.root, "lte", { jobId: holder.jobId, pid: process.pid }, { now: () => FIXED_NOW });
    const { jobId } = await makeJob(harness.root);

    // Act
    await harness.handlers.cancel(jsonPost("cancel", { jobId }));

    // Assert
    expect((await readLockFile(harness.root, "lte"))?.jobId).toBe(holder.jobId);
  });

  it.each(["RUNNING", "CANCELLING"] as const)("should only write cancel.request for a %s job and report REQUESTED", async (state) => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root, { state, mutate: (status) => (status.pid = 99) });

    // Act
    const response = await harness.handlers.cancel(jsonPost("cancel", { jobId }));

    // Assert
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ success: true, jobId, outcome: "REQUESTED" });
    expect(await exists(jobPaths(harness.root, jobId).cancel)).toBe(true);
    expect((await readStatusFile(harness.root, jobId)).state).toBe(state);
    expect(await exists(jobPaths(harness.root, jobId).source)).toBe(true);
    expect(harness.killed).toEqual([]);
  });

  it("should not refresh the cancel.request mtime when Cancel is pressed again", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root, { state: "RUNNING", mutate: (status) => (status.pid = 99) });
    const cancelFile = jobPaths(harness.root, jobId).cancel;
    await harness.handlers.cancel(jsonPost("cancel", { jobId }));
    const original = new Date(FIXED_NOW - 10 * 60_000);
    await utimes(cancelFile, original, original);
    const before = (await stat(cancelFile)).mtimeMs;

    // Act
    const second = await harness.handlers.cancel(jsonPost("cancel", { jobId }));

    // Assert
    expect(second.status).toBe(200);
    expect(await readJson(second)).toEqual({ success: true, jobId, outcome: "REQUESTED" });
    expect((await stat(cancelFile)).mtimeMs).toBe(before);
  });

  it("should keep the original cancel.request content on a repeated Cancel", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root, { state: "RUNNING", mutate: (status) => (status.pid = 99) });
    const cancelFile = jobPaths(harness.root, jobId).cancel;
    await harness.handlers.cancel(jsonPost("cancel", { jobId }));
    const first = await readFile(cancelFile, "utf8");
    harness.clock.now = FIXED_NOW + 60_000;

    // Act
    await harness.handlers.cancel(jsonPost("cancel", { jobId }));

    // Assert
    expect(first).toBe(new Date(FIXED_NOW).toISOString());
    expect(await readFile(cancelFile, "utf8")).toBe(first);
  });

  it.each(["SUCCEEDED", "FAILED", "CANCELLED", "UPLOADING"] as const)("should answer 409 in Spanish for a %s job", async (state) => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root, { state });

    // Act
    const response = await harness.handlers.cancel(jsonPost("cancel", { jobId }));

    // Assert
    expect(response.status).toBe(409);
    expect((await readJson(response)).error).toBe(`La carga no se puede cancelar en estado ${state}.`);
    expect(await exists(jobPaths(harness.root, jobId).cancel)).toBe(false);
  });

  it("should answer 404 for a missing job", async () => {
    // Arrange
    const harness = createHarness(await roots.create());

    // Act
    const response = await harness.handlers.cancel(jsonPost("cancel", { jobId: MISSING_JOB_ID }));

    // Assert
    expect(response.status).toBe(404);
    expect((await readJson(response)).error).toBe("No existe la carga indicada.");
  });

  it("should answer 400 for an invalid id and for a body that is not JSON", async () => {
    // Arrange
    const harness = createHarness(await roots.create());

    // Act
    const badId = await harness.handlers.cancel(jsonPost("cancel", { jobId: "x" }));
    const badJson = await harness.handlers.cancel(jsonPost("cancel", "nope"));

    // Assert
    expect(badId.status).toBe(400);
    expect(badJson.status).toBe(400);
    expect((await readJson(badJson)).success).toBe(false);
  });
});

describe("POST shp/discard", () => {
  it.each(["SUCCEEDED", "FAILED", "CANCELLED"] as const)("should remove the whole folder of a %s job", async (state) => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root, { state });
    await writeFile(jobPaths(harness.root, jobId).log, "log\n");

    // Act
    const response = await harness.handlers.discard(jsonPost("discard", { jobId }));

    // Assert
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ success: true, jobId });
    expect(await exists(jobPaths(harness.root, jobId).dir)).toBe(false);
  });

  it.each(["READY", "UPLOADING", "RUNNING", "CANCELLING"] as const)("should refuse with 409 and keep the folder of a %s job", async (state) => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root, { state });

    // Act
    const response = await harness.handlers.discard(jsonPost("discard", { jobId }));

    // Assert
    expect(response.status).toBe(409);
    expect((await readJson(response)).error).toBe("Solo se pueden descartar cargas terminadas; cancele la carga primero.");
    expect(await exists(jobPaths(harness.root, jobId).status)).toBe(true);
  });

  it("should answer 404 for a missing job", async () => {
    // Arrange
    const harness = createHarness(await roots.create());

    // Act
    const response = await harness.handlers.discard(jsonPost("discard", { jobId: MISSING_JOB_ID }));

    // Assert
    expect(response.status).toBe(404);
  });

  it("should answer 400 for an invalid id without touching anything", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root, { state: "FAILED" });

    // Act
    const response = await harness.handlers.discard(jsonPost("discard", { jobId: `../${jobId}` }));

    // Assert
    expect(response.status).toBe(400);
    expect(await exists(jobPaths(harness.root, jobId).status)).toBe(true);
  });
});
