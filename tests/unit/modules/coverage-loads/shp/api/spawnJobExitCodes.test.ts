import { readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jobPaths } from "@/modules/coverage-loads/shp/job/layout.ts";
import type { JobState } from "@/modules/coverage-loads/shp/job/types.ts";
import {
  CANARY_PASSWORD,
  CONNECTION_BODY,
  createHarness,
  createTmpRoots,
  jsonPost,
  makeJob,
  readAllText,
  readLockFile,
  readStatusFile,
  waitFor,
} from "../helpers/apiTestEnv";

vi.setConfig({ testTimeout: 30_000 });

const roots = createTmpRoots();
afterEach(() => roots.cleanup());

const STATUS_WRITE_FAILED_EXIT = 4;

async function startedJob(state?: JobState, extra: Record<string, unknown> = {}) {
  const harness = createHarness(await roots.create());
  const { jobId } = await makeJob(harness.root);
  await harness.handlers.start(jsonPost("start", { jobId, mode: "LOAD", confirm: true, connection: CONNECTION_BODY }));
  if (state !== undefined) {
    const current = await readStatusFile(harness.root, jobId);
    await writeFile(jobPaths(harness.root, jobId).status, JSON.stringify({ ...current, state, ...extra }, null, 2));
  }
  return { harness, jobId, child: harness.spawn.calls[0].child };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 150));

describe("watchChild exit code 4 (status write failed)", () => {
  it.each(["RUNNING", "CANCELLING"] as const)("should turn a %s job into FAILED/STATUS_WRITE_FAILED and release its lock", async (state) => {
    const { harness, jobId, child } = await startedJob(state);
    expect(await readLockFile(harness.root, "lte")).not.toBeNull();

    child.emit("exit", STATUS_WRITE_FAILED_EXIT);
    await waitFor(async () => (await readStatusFile(harness.root, jobId)).state === "FAILED");

    const status = await readStatusFile(harness.root, jobId);
    expect(status.error?.code).toBe("STATUS_WRITE_FAILED");
    expect(status.error?.message).toBeTruthy();
    await waitFor(async () => (await readLockFile(harness.root, "lte")) === null);
  });

  it.each(["SUCCEEDED", "FAILED", "CANCELLED"] as const)("should leave an already %s job byte for byte untouched", async (state) => {
    const { harness, jobId, child } = await startedJob(state);
    const before = await readFile(jobPaths(harness.root, jobId).status, "utf8");

    child.emit("exit", STATUS_WRITE_FAILED_EXIT);
    await settle();

    expect(await readFile(jobPaths(harness.root, jobId).status, "utf8")).toBe(before);
    expect((await readStatusFile(harness.root, jobId)).state).toBe(state);
  });

  it("should keep the original error of a job that already FAILED for another reason", async () => {
    const { harness, jobId, child } = await startedJob("FAILED", { error: { code: "PIPELINE_ERROR", message: "boom", stage: "COPYING" } });

    child.emit("exit", STATUS_WRITE_FAILED_EXIT);
    await settle();

    expect((await readStatusFile(harness.root, jobId)).error?.code).toBe("PIPELINE_ERROR");
  });

  it("should not leak the password into any file while handling exit 4", async () => {
    const { harness, jobId, child } = await startedJob("RUNNING");

    child.emit("exit", STATUS_WRITE_FAILED_EXIT);
    await waitFor(async () => (await readStatusFile(harness.root, jobId)).state === "FAILED");

    expect(await readAllText(harness.root)).not.toContain(CANARY_PASSWORD);
  });

  it("should do nothing when the status file is gone", async () => {
    const { harness, jobId, child } = await startedJob();
    await writeFile(jobPaths(harness.root, jobId).status, "{ not json");

    child.emit("exit", STATUS_WRITE_FAILED_EXIT);
    await settle();

    expect(await readFile(jobPaths(harness.root, jobId).status, "utf8")).toBe("{ not json");
  });
});

describe("watchChild other exit codes keep their behaviour", () => {
  it("should mark a READY job FAILED/SPAWN_FAILED and free the lock on exit 1", async () => {
    const { harness, jobId, child } = await startedJob();

    child.emit("exit", 1);
    await waitFor(async () => (await readStatusFile(harness.root, jobId)).state === "FAILED");

    const status = await readStatusFile(harness.root, jobId);
    expect(status.error?.code).toBe("SPAWN_FAILED");
    expect(status.error?.message).toContain("código 1");
    expect(await readLockFile(harness.root, "lte")).toBeNull();
  });

  it.each(["RUNNING", "CANCELLING"] as const)("should leave a %s job and its lock alone on exit 1 (the sweeper decides)", async (state) => {
    const { harness, jobId, child } = await startedJob(state);

    child.emit("exit", 1);
    await settle();

    expect((await readStatusFile(harness.root, jobId)).state).toBe(state);
    expect(await readLockFile(harness.root, "lte")).not.toBeNull();
  });

  it("should leave a RUNNING job alone on exit 0", async () => {
    const { harness, jobId, child } = await startedJob("RUNNING");

    child.emit("exit", 0);
    await settle();

    expect((await readStatusFile(harness.root, jobId)).state).toBe("RUNNING");
  });
});
