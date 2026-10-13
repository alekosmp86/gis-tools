import { utimes, writeFile, mkdir } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { acquireTableLock } from "@/modules/coverage-loads/shp/job/lock.ts";
import { jobPaths } from "@/modules/coverage-loads/shp/job/layout.ts";
import { FORCE_KILL_AFTER_MS } from "@/modules/coverage-loads/shp/constants";
import { DEAD_JOB_HEARTBEAT_MS } from "@/modules/coverage-loads/shp/job/constants.ts";
import { FORCE_KILLED_ERROR } from "@/modules/coverage-loads/shp/services/sweeper";
import { createHarness, createTmpRoots, exists, FIXED_NOW, getRequest, jsonPost, makeJob, MISSING_JOB_ID, readJson, readLockFile, readStatusFile } from "../helpers/apiTestEnv";
import type { Harness } from "../helpers/apiTestEnv";
import type { JobStatus } from "@/modules/coverage-loads/shp/job/types.ts";

const roots = createTmpRoots();
afterEach(() => roots.cleanup());

const iso = (offsetMs: number) => new Date(FIXED_NOW + offsetMs).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A RUNNING job with a fresh heartbeat, a source file and the table lock. */
async function runningJob(harness: Harness, pid: number | null = 777, mutate?: (status: JobStatus) => void) {
  const job = await makeJob(harness.root, {
    state: "RUNNING",
    mutate: (status) => {
      status.pid = pid;
      status.heartbeatAt = iso(0);
      mutate?.(status);
    },
  });
  await acquireTableLock(harness.root, "lte", { jobId: job.jobId, pid: pid ?? process.pid }, { now: () => FIXED_NOW, isPidAlive: () => true });
  return job;
}

async function requestCancelAt(harness: Harness, jobId: string, ageMs: number) {
  const file = jobPaths(harness.root, jobId).cancel;
  await writeFile(file, "x");
  const when = new Date(FIXED_NOW - ageMs);
  await utimes(file, when, when);
}

describe("sweeper: when it runs", () => {
  it("should run once, on the first shp request of the process, and not on later ones", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    await harness.handlers.status(getRequest("status", { jobId: MISSING_JOB_ID }));
    const crashed = await makeJob(harness.root, { state: "RUNNING", mutate: (status) => ((status.pid = 9), (status.heartbeatAt = iso(-5 * MINUTE))) });

    // Act
    await harness.handlers.status(getRequest("status", { jobId: crashed.jobId }));
    const stateAfterSecondRequest = (await readStatusFile(harness.root, crashed.jobId)).state;

    // Assert
    expect(stateAfterSecondRequest).toBe("RUNNING");
  });

  it("should run on every GET shp/jobs", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    await harness.handlers.jobs(getRequest("jobs"));
    const crashed = await makeJob(harness.root, { state: "RUNNING", mutate: (status) => ((status.pid = 9), (status.heartbeatAt = iso(-5 * MINUTE))) });

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect((await readStatusFile(harness.root, crashed.jobId)).state).toBe("FAILED");
  });

  it.each([
    ["status", () => getRequest("status", { jobId: MISSING_JOB_ID })],
    ["log", () => getRequest("log", { jobId: MISSING_JOB_ID })],
    ["cancel", () => jsonPost("cancel", { jobId: MISSING_JOB_ID })],
    ["discard", () => jsonPost("discard", { jobId: MISSING_JOB_ID })],
  ] as const)("should run the first-request sweep from the %s endpoint too", async (name, makeRequest) => {
    // Arrange
    const harness = createHarness(await roots.create());
    const crashed = await makeJob(harness.root, { state: "RUNNING", mutate: (status) => ((status.pid = 9), (status.heartbeatAt = iso(-5 * MINUTE))) });

    // Act
    await harness.handlers[name](makeRequest());

    // Assert
    expect((await readStatusFile(harness.root, crashed.jobId)).state).toBe("FAILED");
  });

  it("should let concurrent sweeps share one run instead of overlapping", async () => {
    // Arrange: with no jobs, the only clock read left in a request is the one a sweep makes
    const root = await roots.create();
    let clockReads = 0;
    const harness = createHarness(root, {
      now: () => {
        clockReads += 1;
        return FIXED_NOW;
      },
    });
    await harness.handlers.jobs(getRequest("jobs"));
    const readsPerSweep = clockReads;
    clockReads = 0;

    // Act
    await Promise.all([harness.handlers.jobs(getRequest("jobs")), harness.handlers.jobs(getRequest("jobs")), harness.handlers.jobs(getRequest("jobs"))]);

    // Assert
    expect(readsPerSweep).toBe(1);
    expect(clockReads).toBe(1);
  });

  it("should run a new sweep once the previous one has finished", async () => {
    // Arrange
    const root = await roots.create();
    let clockReads = 0;
    const harness = createHarness(root, {
      now: () => {
        clockReads += 1;
        return FIXED_NOW;
      },
    });

    // Act
    await harness.handlers.jobs(getRequest("jobs"));
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect(clockReads).toBe(2);
  });

  it("should never throw into the response when the sweep blows up", async () => {
    // Arrange: only the first liveness probe (made by the sweep) throws
    const root = await roots.create();
    let probes = 0;
    const harness = createHarness(root, {
      isPidAlive: () => {
        probes += 1;
        if (probes === 1) throw new Error("process table exploded");
        return false;
      },
    });
    const { jobId } = await makeJob(root, { state: "RUNNING", mutate: (status) => ((status.pid = 9), (status.heartbeatAt = iso(-5 * MINUTE))) });

    // Act
    const statusResponse = await harness.handlers.status(getRequest("status", { jobId }));
    const body = await readJson(statusResponse);

    // Assert
    expect(statusResponse.status).toBe(200);
    expect(body.status.state).toBe("RUNNING");
    expect(probes).toBeGreaterThan(1);
  });

  it("should keep working after a failed sweep (the next one runs normally)", async () => {
    // Arrange
    const root = await roots.create();
    let explode = true;
    let calls = 0;
    const harness = createHarness(root, {
      isPidAlive: () => {
        calls += 1;
        if (explode && calls === 1) throw new Error("boom");
        return false;
      },
    });
    const crashed = await makeJob(root, { state: "RUNNING", mutate: (status) => ((status.pid = 9), (status.heartbeatAt = iso(-5 * MINUTE))) });
    await harness.handlers.jobs(getRequest("jobs"));
    explode = false;

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect((await readStatusFile(root, crashed.jobId)).state).toBe("FAILED");
  });
});

describe("sweeper: force-kill fallback", () => {
  it("should kill the pid and finalise as CANCELLED / FORCE_KILLED when a cancel was ignored for over 30 s", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    harness.alivePids.add(777);
    const { jobId } = await runningJob(harness, 777);
    await requestCancelAt(harness, jobId, FORCE_KILL_AFTER_MS + 1000);

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect(FORCE_KILL_AFTER_MS).toBe(30_000);
    expect(harness.killed).toEqual([777]);
    const status = await readStatusFile(harness.root, jobId);
    expect(status.state).toBe("CANCELLED");
    expect(status.error).toEqual({ code: "FORCE_KILLED", message: FORCE_KILLED_ERROR.message, stage: null });
    expect(await exists(jobPaths(harness.root, jobId).source)).toBe(false);
    expect(await readLockFile(harness.root, "lte")).toBeNull();
  });

  it("should record the stage the job was in when it was killed", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    harness.alivePids.add(777);
    const { jobId } = await runningJob(harness, 777, (status) => (status.stage = "STAGING"));
    await requestCancelAt(harness, jobId, 5 * MINUTE);

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect((await readStatusFile(harness.root, jobId)).error?.stage).toBe("STAGING");
  });

  it("should still finalise the job when the kill itself throws", async () => {
    // Arrange
    const harness = createHarness(await roots.create(), {
      killProcess: () => {
        throw new Error("ESRCH");
      },
    });
    harness.alivePids.add(777);
    const { jobId } = await runningJob(harness, 777);
    await requestCancelAt(harness, jobId, 5 * MINUTE);

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect((await readStatusFile(harness.root, jobId)).error?.code).toBe("FORCE_KILLED");
  });

  it("should kill a CANCELLING job as well", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    harness.alivePids.add(777);
    const job = await makeJob(harness.root, { state: "CANCELLING", mutate: (status) => ((status.pid = 777), (status.heartbeatAt = iso(0))) });
    await requestCancelAt(harness, job.jobId, 5 * MINUTE);

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect(harness.killed).toEqual([777]);
  });

  it("should not kill when the cancel request is exactly 30 s old", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    harness.alivePids.add(777);
    const { jobId } = await runningJob(harness, 777);
    await requestCancelAt(harness, jobId, FORCE_KILL_AFTER_MS);

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect(harness.killed).toEqual([]);
    expect((await readStatusFile(harness.root, jobId)).state).toBe("RUNNING");
  });

  it("should not kill when the cancel request is fresh", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    harness.alivePids.add(777);
    const { jobId } = await runningJob(harness, 777);
    await requestCancelAt(harness, jobId, 5000);

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect(harness.killed).toEqual([]);
    expect((await readStatusFile(harness.root, jobId)).state).toBe("RUNNING");
  });

  it("should not kill when no cancel was ever requested", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    harness.alivePids.add(777);
    const { jobId } = await runningJob(harness, 777);

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect(harness.killed).toEqual([]);
    expect((await readStatusFile(harness.root, jobId)).state).toBe("RUNNING");
  });

  it("should not kill when the pid is already dead", async () => {
    // Arrange: dead pid, fresh heartbeat so the crash sweep leaves the job alone as well
    const harness = createHarness(await roots.create());
    const { jobId } = await runningJob(harness, 777);
    await requestCancelAt(harness, jobId, 5 * MINUTE);

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect(harness.killed).toEqual([]);
    expect((await readStatusFile(harness.root, jobId)).error).toBeNull();
  });

  it("should not kill a live-state job that has no pid", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await runningJob(harness, null);
    await requestCancelAt(harness, jobId, 5 * MINUTE);

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect(harness.killed).toEqual([]);
    expect((await readStatusFile(harness.root, jobId)).state).toBe("RUNNING");
  });

  it.each(["SUCCEEDED", "FAILED", "CANCELLED", "READY"] as const)("should not kill the pid of a %s job", async (state) => {
    // Arrange
    const harness = createHarness(await roots.create());
    harness.alivePids.add(777);
    const { jobId } = await makeJob(harness.root, { state, mutate: (status) => (status.pid = 777) });
    await requestCancelAt(harness, jobId, 5 * MINUTE);

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect(harness.killed).toEqual([]);
    expect((await readStatusFile(harness.root, jobId)).error).toBeNull();
  });
});

describe("sweeper: force-kill and pid reuse", () => {
  it("should never SIGKILL an answering pid whose heartbeat is stale (the pid may have been reused)", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    harness.alivePids.add(777);
    const { jobId } = await runningJob(harness, 777, (status) => (status.heartbeatAt = iso(-5 * MINUTE)));
    await requestCancelAt(harness, jobId, 5 * MINUTE);

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect(harness.killed).toEqual([]);
    const status = await readStatusFile(harness.root, jobId);
    expect(status.state).toBe("RUNNING");
    expect(status.error).toBeNull();
  });

  it("should fail as JOB_CRASHED, not FORCE_KILLED, an answering pid whose heartbeat is older than the reuse bound", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    harness.alivePids.add(777);
    const { jobId } = await runningJob(harness, 777, (status) => (status.heartbeatAt = iso(-11 * MINUTE)));
    await requestCancelAt(harness, jobId, 5 * MINUTE);

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect(harness.killed).toEqual([]);
    const status = await readStatusFile(harness.root, jobId);
    expect(status.state).toBe("FAILED");
    expect(status.error?.code).toBe("JOB_CRASHED");
    expect(await readLockFile(harness.root, "lte")).toBeNull();
  });

  it("should still kill when the heartbeat is exactly at the dead-job threshold", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    harness.alivePids.add(777);
    const { jobId } = await runningJob(harness, 777, (status) => (status.heartbeatAt = iso(-DEAD_JOB_HEARTBEAT_MS)));
    await requestCancelAt(harness, jobId, 5 * MINUTE);

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect(harness.killed).toEqual([777]);
    expect((await readStatusFile(harness.root, jobId)).error?.code).toBe("FORCE_KILLED");
  });

  it("should not kill when the heartbeat is one millisecond past the dead-job threshold", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    harness.alivePids.add(777);
    const { jobId } = await runningJob(harness, 777, (status) => (status.heartbeatAt = iso(-DEAD_JOB_HEARTBEAT_MS - 1)));
    await requestCancelAt(harness, jobId, 5 * MINUTE);

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect(harness.killed).toEqual([]);
  });

  it("should judge freshness by updatedAt when the job never wrote a heartbeat", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    harness.alivePids.add(777);
    const { jobId } = await runningJob(harness, 777, (status) => ((status.heartbeatAt = null), (status.updatedAt = iso(-1000))));
    await requestCancelAt(harness, jobId, 5 * MINUTE);

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect(harness.killed).toEqual([777]);
  });

  it("should not kill when the heartbeat is unparsable", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    harness.alivePids.add(777);
    const { jobId } = await runningJob(harness, 777, (status) => (status.heartbeatAt = "not-a-date"));
    await requestCancelAt(harness, jobId, 5 * MINUTE);

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect(harness.killed).toEqual([]);
  });
});

describe("sweeper: abandoned READY jobs through the API", () => {
  it("should cancel a READY job idle for more than 24 h, free its lock and remove its source", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root, { state: "READY", now: FIXED_NOW - 25 * HOUR });
    await acquireTableLock(harness.root, "lte", { jobId, pid: 1 }, { now: () => FIXED_NOW, isPidAlive: () => true });

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect((await readStatusFile(harness.root, jobId)).state).toBe("CANCELLED");
    expect(await exists(jobPaths(harness.root, jobId).source)).toBe(false);
    expect(await readLockFile(harness.root, "lte")).toBeNull();
  });

  it("should keep a READY job idle for less than 24 h", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root, { state: "READY", now: FIXED_NOW - 23 * HOUR });

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect((await readStatusFile(harness.root, jobId)).state).toBe("READY");
    expect(await exists(jobPaths(harness.root, jobId).source)).toBe(true);
  });

  it("should keep an old READY job while a fresh start.lock marks a start in progress", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root, { state: "READY", now: FIXED_NOW - 25 * HOUR });
    await writeFile(jobPaths(harness.root, jobId).startLock, "marker");
    const fresh = new Date(FIXED_NOW - 5000);
    await utimes(jobPaths(harness.root, jobId).startLock, fresh, fresh);

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect((await readStatusFile(harness.root, jobId)).state).toBe("READY");
  });
});

describe("sweeper: job-safe effects through the API", () => {
  it("should remove an abandoned upload folder", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root, { state: "UPLOADING", now: FIXED_NOW - 3 * HOUR, source: false });
    const part = jobPaths(harness.root, jobId).upload;
    await writeFile(part, "partial");
    const old = new Date(FIXED_NOW - 3 * HOUR);
    await utimes(part, old, old);

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect(await exists(jobPaths(harness.root, jobId).dir)).toBe(false);
  });

  it("should keep a recent upload", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await makeJob(harness.root, { state: "UPLOADING", now: FIXED_NOW - 10 * MINUTE, source: false });

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect(await exists(jobPaths(harness.root, jobId).status)).toBe(true);
  });

  it("should turn a crashed job into FAILED / JOB_CRASHED, free its lock and remove its source", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await runningJob(harness, 777, (status) => (status.heartbeatAt = iso(-5 * MINUTE)));

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    const status = await readStatusFile(harness.root, jobId);
    expect(status.state).toBe("FAILED");
    expect(status.error?.code).toBe("JOB_CRASHED");
    expect(await exists(jobPaths(harness.root, jobId).source)).toBe(false);
    expect(await readLockFile(harness.root, "lte")).toBeNull();
  });

  it("should not touch a RUNNING job whose pid is alive", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    harness.alivePids.add(777);
    const { jobId } = await runningJob(harness, 777, (status) => (status.heartbeatAt = iso(-5 * MINUTE)));

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect((await readStatusFile(harness.root, jobId)).state).toBe("RUNNING");
    expect(await readLockFile(harness.root, "lte")).not.toBeNull();
  });

  it("should delete terminal jobs older than the 7-day retention and keep younger ones", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const old = await makeJob(harness.root, { state: "FAILED", now: FIXED_NOW - 8 * 24 * HOUR });
    const young = await makeJob(harness.root, { state: "FAILED", now: FIXED_NOW - 6 * 24 * HOUR });

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect(await exists(jobPaths(harness.root, old.jobId).dir)).toBe(false);
    expect(await exists(jobPaths(harness.root, young.jobId).status)).toBe(true);
  });

  it("should release an orphan lock whose owner job is gone", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    await mkdir(`${harness.root}/locks`, { recursive: true });
    await writeFile(`${harness.root}/locks/lte.json`, JSON.stringify({ table: "lte", jobId: MISSING_JOB_ID, pid: 1, acquiredAt: iso(0) }));

    // Act
    await harness.handlers.jobs(getRequest("jobs"));

    // Assert
    expect(await readLockFile(harness.root, "lte")).toBeNull();
  });

  it("should answer the jobs list with the post-sweep state", async () => {
    // Arrange
    const harness = createHarness(await roots.create());
    const { jobId } = await runningJob(harness, 777, (status) => (status.heartbeatAt = iso(-5 * MINUTE)));

    // Act
    const body = await readJson(await harness.handlers.jobs(getRequest("jobs")));

    // Assert
    expect(body.jobs[0]).toMatchObject({ jobId, state: "FAILED", errorMessage: "El proceso de carga terminó de forma inesperada." });
  });
});
