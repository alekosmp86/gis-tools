import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEAD_JOB_HEARTBEAT_MS } from "@/modules/coverage-loads/shp/job/constants.ts";
import { createTmpRoots, makeJob } from "../helpers/jobTestEnv.ts";

vi.setConfig({ testTimeout: 60_000 });

const control = vi.hoisted(() => ({ failures: 0, code: "EBUSY", failedCalls: 0 }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      if (to.endsWith("status.json") && control.failures > 0) {
        control.failures -= 1;
        control.failedCalls += 1;
        throw Object.assign(new Error(`injected ${control.code}`), { code: control.code });
      }
      return actual.rename(from, to);
    },
  };
});

const { cancelReadyStatus, sweepJobs } = await import("@/modules/coverage-loads/shp/job/cleanup.ts");
const { readStatus } = await import("@/modules/coverage-loads/shp/job/statusFile.ts");
const { writeJobStatus } = await import("@/modules/coverage-loads/shp/services/jobStore.ts");

const roots = createTmpRoots();
const NOW = Date.parse("2026-05-01T12:00:00.000Z");
const MORE_THAN_SHORT_RETRIES = 6;

beforeEach(() => {
  control.failures = 0;
  control.code = "EBUSY";
  control.failedCalls = 0;
});
afterEach(() => roots.cleanup());

describe("parent-side terminal writes are durable", () => {
  it.each(["EPERM", "EBUSY", "EACCES"])("should let jobStore.writeJobStatus ride out %s beyond the short retries", async (code) => {
    const root = await roots.create();
    const { jobId, status } = await makeJob(root);
    status.state = "FAILED";
    control.code = code;
    control.failures = MORE_THAN_SHORT_RETRIES;

    await writeJobStatus(root, status);

    expect(control.failedCalls).toBe(MORE_THAN_SHORT_RETRIES);
    expect((await readStatus(root, jobId))?.state).toBe("FAILED");
  });

  it("should let cleanup.cancelReadyStatus ride out transient EPERM beyond the short retries", async () => {
    const root = await roots.create();
    const { jobId, status } = await makeJob(root);
    control.code = "EPERM";
    control.failures = MORE_THAN_SHORT_RETRIES;

    await cancelReadyStatus(root, status, NOW);

    expect(control.failedCalls).toBe(MORE_THAN_SHORT_RETRIES);
    expect((await readStatus(root, jobId))?.state).toBe("CANCELLED");
  });

  it("should let the sweeper record a crashed job through transient EBUSY failures beyond the short retries", async () => {
    const root = await roots.create();
    const { jobId } = await makeJob(root, {
      state: "RUNNING",
      mutate: (s) => ((s.pid = 4242), (s.heartbeatAt = new Date(NOW - DEAD_JOB_HEARTBEAT_MS - 60_000).toISOString())),
    });
    control.failures = MORE_THAN_SHORT_RETRIES;

    const summary = await sweepJobs(root, NOW, { isPidAlive: () => false });

    expect(summary.crashed).toEqual([jobId]);
    expect(control.failedCalls).toBe(MORE_THAN_SHORT_RETRIES);
    expect((await readStatus(root, jobId))?.state).toBe("FAILED");
  });

  it("should reject writeJobStatus on a non-retryable error without retrying", async () => {
    const root = await roots.create();
    const { status } = await makeJob(root);
    control.code = "ENOSPC";
    control.failures = 1;

    await expect(writeJobStatus(root, status)).rejects.toMatchObject({ code: "ENOSPC" });

    expect(control.failedCalls).toBe(1);
  });
});
