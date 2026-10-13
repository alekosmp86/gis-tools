import { randomUUID } from "node:crypto";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ABANDONED_UPLOAD_MS,
  DEAD_JOB_HEARTBEAT_MS,
  PID_REUSE_HEARTBEAT_BOUND_MS,
  READY_ABANDONED_MS,
  READY_LOCK_GRACE_MS,
  RETENTION_MS,
  START_MARKER_FRESH_MS,
} from "@/modules/coverage-loads/shp/job/constants.ts";
import { discardJob, sweepJobs } from "@/modules/coverage-loads/shp/job/cleanup.ts";
import { jobPaths, jobsDir, lockPath, locksDir } from "@/modules/coverage-loads/shp/job/layout.ts";
import { readLock } from "@/modules/coverage-loads/shp/job/lock.ts";
import { readStatus } from "@/modules/coverage-loads/shp/job/statusFile.ts";
import { JOB_STATE } from "@/modules/coverage-loads/shp/job/types.ts";
import type { JobState } from "@/modules/coverage-loads/shp/job/types.ts";
import { createTmpRoots, dirExists, exists, makeJob } from "../helpers/jobTestEnv.ts";

const roots = createTmpRoots();
afterEach(() => roots.cleanup());

const NOW = Date.parse("2026-05-01T12:00:00.000Z");
const dead = () => false;
const alive = () => true;
const EMPTY_SUMMARY = { abandonedUploads: [], abandonedReady: [], crashed: [], expired: [], sourcesRemoved: [], locksRemoved: [] };

async function putLock(root: string, jobId: string, table: "lte" | "nbiot" = "lte"): Promise<void> {
  await mkdir(locksDir(root), { recursive: true });
  await writeFile(lockPath(root, table), JSON.stringify({ table, jobId, pid: 1, acquiredAt: new Date(NOW).toISOString() }));
}

describe("sweepJobs abandoned uploads", () => {
  it("should remove an UPLOADING job idle for more than 2 h and keep a fresh one", async () => {
    const root = await roots.create();
    const old = await makeJob(root, { state: JOB_STATE.UPLOADING, now: NOW - ABANDONED_UPLOAD_MS - 1000 });
    const fresh = await makeJob(root, { state: JOB_STATE.UPLOADING, now: NOW - 60_000 });

    const summary = await sweepJobs(root, NOW);

    expect(summary.abandonedUploads).toEqual([old.jobId]);
    expect(await dirExists(jobPaths(root, old.jobId).dir)).toBe(false);
    expect(await dirExists(jobPaths(root, fresh.jobId).dir)).toBe(true);
  });

  it("should keep an UPLOADING job exactly at the 2 h boundary", async () => {
    const root = await roots.create();
    const edge = await makeJob(root, { state: JOB_STATE.UPLOADING, now: NOW - ABANDONED_UPLOAD_MS });

    const summary = await sweepJobs(root, NOW);

    expect(summary.abandonedUploads).toEqual([]);
    expect(await dirExists(jobPaths(root, edge.jobId).dir)).toBe(true);
  });

  it("should keep an old-status UPLOADING job whose upload.part grew recently", async () => {
    const root = await roots.create();
    const job = await makeJob(root, { state: JOB_STATE.UPLOADING, now: NOW - 5 * ABANDONED_UPLOAD_MS });
    const part = jobPaths(root, job.jobId).upload;
    await writeFile(part, "chunk");
    const recent = new Date(NOW - 1000);
    await utimes(part, recent, recent);

    const summary = await sweepJobs(root, NOW);

    expect(summary.abandonedUploads).toEqual([]);
    expect(await exists(part)).toBe(true);
  });

  it("should honour an injected abandonedUploadMs", async () => {
    const root = await roots.create();
    const job = await makeJob(root, { state: JOB_STATE.UPLOADING, now: NOW - 5000 });

    const summary = await sweepJobs(root, NOW, { abandonedUploadMs: 1000 });

    expect(summary.abandonedUploads).toEqual([job.jobId]);
  });
});

describe("sweepJobs crashed jobs", () => {
  it.each([JOB_STATE.RUNNING, JOB_STATE.CANCELLING])("should fail a %s job with a dead pid and stale heartbeat as JOB_CRASHED", async (state) => {
    const root = await roots.create();
    const job = await makeJob(root, {
      state,
      mutate: (s) => ((s.pid = 4242), (s.heartbeatAt = new Date(NOW - 10 * 60_000).toISOString()), (s.stage = "STAGING")),
    });
    await putLock(root, job.jobId);

    const summary = await sweepJobs(root, NOW, { isPidAlive: dead });

    const status = await readStatus(root, job.jobId);
    expect(status?.state).toBe(JOB_STATE.FAILED);
    expect(status?.error?.code).toBe("JOB_CRASHED");
    expect(summary.crashed).toEqual([job.jobId]);
    expect(await exists(jobPaths(root, job.jobId).source)).toBe(false);
    expect(summary.sourcesRemoved).toEqual([job.jobId]);
    expect(await readLock(root, "lte")).toBeNull();
    expect(summary.locksRemoved).toEqual([job.jobId]);
  });

  it("should leave a RUNNING job alone when its pid is alive", async () => {
    const root = await roots.create();
    const job = await makeJob(root, {
      state: JOB_STATE.RUNNING,
      mutate: (s) => ((s.pid = 4242), (s.heartbeatAt = new Date(NOW - 5 * 60_000).toISOString())),
    });
    await putLock(root, job.jobId);

    const summary = await sweepJobs(root, NOW, { isPidAlive: alive });

    expect((await readStatus(root, job.jobId))?.state).toBe(JOB_STATE.RUNNING);
    expect(summary).toEqual(EMPTY_SUMMARY);
    expect(await exists(jobPaths(root, job.jobId).source)).toBe(true);
    expect((await readLock(root, "lte"))?.jobId).toBe(job.jobId);
  });

  it("should leave a fresh READY job untouched", async () => {
    const root = await roots.create();
    const job = await makeJob(root, { state: JOB_STATE.READY, now: NOW - 60_000 });

    const summary = await sweepJobs(root, NOW, { isPidAlive: dead });

    expect(summary.crashed).toEqual([]);
    expect(await exists(jobPaths(root, job.jobId).source)).toBe(true);
  });
});

describe("sweepJobs terminal jobs", () => {
  it.each([JOB_STATE.SUCCEEDED, JOB_STATE.FAILED, JOB_STATE.CANCELLED] as JobState[])(
    "should remove the source of a %s job but keep its folder before retention",
    async (state) => {
      const root = await roots.create();
      const job = await makeJob(root, { state, now: NOW - RETENTION_MS + 60_000 });
      await mkdir(locksDir(root), { recursive: true });

      const summary = await sweepJobs(root, NOW);

      expect(await exists(jobPaths(root, job.jobId).source)).toBe(false);
      expect(await dirExists(jobPaths(root, job.jobId).dir)).toBe(true);
      expect(summary.sourcesRemoved).toEqual([job.jobId]);
      expect(summary.expired).toEqual([]);
    }
  );

  it("should keep the folder exactly at the 7 day boundary and remove it one ms later", async () => {
    const root = await roots.create();
    const edge = await makeJob(root, { state: JOB_STATE.SUCCEEDED, now: NOW - RETENTION_MS });
    const past = await makeJob(root, { state: JOB_STATE.SUCCEEDED, now: NOW - RETENTION_MS - 1 });

    const summary = await sweepJobs(root, NOW);

    expect(await dirExists(jobPaths(root, edge.jobId).dir)).toBe(true);
    expect(await dirExists(jobPaths(root, past.jobId).dir)).toBe(false);
    expect(summary.expired).toEqual([past.jobId]);
  });

  it("should release the lock of a terminal job it owns but not another job's lock", async () => {
    const root = await roots.create();
    const finished = await makeJob(root, { state: JOB_STATE.SUCCEEDED, table: "lte", now: NOW - 1000 });
    const other = await makeJob(root, { state: JOB_STATE.READY, table: "nbiot" });
    await putLock(root, finished.jobId, "lte");
    await putLock(root, other.jobId, "nbiot");

    const summary = await sweepJobs(root, NOW);

    expect(await readLock(root, "lte")).toBeNull();
    expect((await readLock(root, "nbiot"))?.jobId).toBe(other.jobId);
    expect(summary.locksRemoved).toEqual([finished.jobId]);
  });

  it("should honour an injected retentionMs", async () => {
    const root = await roots.create();
    const job = await makeJob(root, { state: JOB_STATE.FAILED, now: NOW - 5000 });

    const summary = await sweepJobs(root, NOW, { retentionMs: 1000 });

    expect(summary.expired).toEqual([job.jobId]);
  });

  it("should be idempotent when run twice", async () => {
    const root = await roots.create();
    await makeJob(root, { state: JOB_STATE.SUCCEEDED, now: NOW - 1000 });

    await sweepJobs(root, NOW);
    const second = await sweepJobs(root, NOW);

    expect(second).toEqual(EMPTY_SUMMARY);
  });
});

describe("sweepJobs orphan locks and robustness", () => {
  it("should remove a lock whose owner has no status", async () => {
    const root = await roots.create();
    const ghost = randomUUID();
    await putLock(root, ghost);

    const summary = await sweepJobs(root, NOW);

    expect(await readLock(root, "lte")).toBeNull();
    expect(summary.locksRemoved).toEqual([ghost]);
  });

  it("should keep a lock whose owner is RUNNING and alive", async () => {
    const root = await roots.create();
    const job = await makeJob(root, { state: JOB_STATE.RUNNING, mutate: (s) => ((s.pid = 1), (s.heartbeatAt = new Date(NOW).toISOString())) });
    await putLock(root, job.jobId);

    await sweepJobs(root, NOW, { isPidAlive: alive });

    expect((await readLock(root, "lte"))?.jobId).toBe(job.jobId);
  });

  it("should not throw when the root does not exist", async () => {
    const root = await roots.create();
    const missing = path.join(root, "nope");

    await expect(sweepJobs(missing, NOW)).resolves.toEqual(EMPTY_SUMMARY);
  });

  it("should skip folders that are not valid job ids and jobs without a readable status", async () => {
    const root = await roots.create();
    await mkdir(path.join(jobsDir(root), "not-a-job-id"), { recursive: true });
    await writeFile(path.join(jobsDir(root), "not-a-job-id", "status.json"), "{}");
    const brokenId = randomUUID();
    await mkdir(jobPaths(root, brokenId).dir, { recursive: true });
    await writeFile(jobPaths(root, brokenId).status, "{broken");

    const summary = await sweepJobs(root, NOW);

    expect(summary).toEqual(EMPTY_SUMMARY);
    expect(await dirExists(jobPaths(root, brokenId).dir)).toBe(true);
    expect(await dirExists(path.join(jobsDir(root), "not-a-job-id"))).toBe(true);
  });
});

async function putStartMarker(root: string, jobId: string, ageMs: number): Promise<void> {
  const marker = jobPaths(root, jobId).startLock;
  await writeFile(marker, "marker");
  const when = new Date(NOW - ageMs);
  await utimes(marker, when, when);
}

describe("sweepJobs pid reuse", () => {
  it("should treat a RUNNING job whose pid answers but whose heartbeat is older than 10x the dead threshold as crashed", async () => {
    const root = await roots.create();
    const job = await makeJob(root, {
      state: JOB_STATE.RUNNING,
      mutate: (s) => ((s.pid = 4242), (s.heartbeatAt = new Date(NOW - PID_REUSE_HEARTBEAT_BOUND_MS - 1000).toISOString())),
    });
    await putLock(root, job.jobId);

    const summary = await sweepJobs(root, NOW, { isPidAlive: alive });

    const status = await readStatus(root, job.jobId);
    expect(status?.state).toBe(JOB_STATE.FAILED);
    expect(status?.error?.code).toBe("JOB_CRASHED");
    expect(summary.crashed).toEqual([job.jobId]);
    expect(summary.locksRemoved).toEqual([job.jobId]);
    expect(await readLock(root, "lte")).toBeNull();
  });

  it("should keep a RUNNING job with an answering pid exactly at the pid-reuse bound", async () => {
    const root = await roots.create();
    const job = await makeJob(root, {
      state: JOB_STATE.RUNNING,
      mutate: (s) => ((s.pid = 4242), (s.heartbeatAt = new Date(NOW - PID_REUSE_HEARTBEAT_BOUND_MS).toISOString())),
    });

    const summary = await sweepJobs(root, NOW, { isPidAlive: alive });

    expect(summary.crashed).toEqual([]);
    expect((await readStatus(root, job.jobId))?.state).toBe(JOB_STATE.RUNNING);
  });

  it("should fall back to updatedAt when a live-pid job has no heartbeat at all", async () => {
    const root = await roots.create();
    const job = await makeJob(root, {
      state: JOB_STATE.RUNNING,
      now: NOW - PID_REUSE_HEARTBEAT_BOUND_MS - 1000,
      mutate: (s) => (s.pid = 4242),
    });

    const summary = await sweepJobs(root, NOW, { isPidAlive: alive });

    expect(summary.crashed).toEqual([job.jobId]);
  });

  it("should keep a RUNNING job with an answering pid and a heartbeat between the dead threshold and the reuse bound", async () => {
    const root = await roots.create();
    const job = await makeJob(root, {
      state: JOB_STATE.RUNNING,
      mutate: (s) => ((s.pid = 4242), (s.heartbeatAt = new Date(NOW - DEAD_JOB_HEARTBEAT_MS - 1000).toISOString())),
    });

    const summary = await sweepJobs(root, NOW, { isPidAlive: alive });

    expect(summary.crashed).toEqual([]);
    expect((await readStatus(root, job.jobId))?.state).toBe(JOB_STATE.RUNNING);
  });
});

describe("sweepJobs abandoned READY jobs", () => {
  it("should cancel a READY job idle for more than 24 h, remove its source and release its lock", async () => {
    const root = await roots.create();
    const job = await makeJob(root, { state: JOB_STATE.READY, now: NOW - READY_ABANDONED_MS - 1000 });
    await putLock(root, job.jobId);

    const summary = await sweepJobs(root, NOW, { isPidAlive: dead });

    expect((await readStatus(root, job.jobId))?.state).toBe(JOB_STATE.CANCELLED);
    expect(summary.abandonedReady).toEqual([job.jobId]);
    expect(summary.sourcesRemoved).toEqual([job.jobId]);
    expect(summary.locksRemoved).toEqual([job.jobId]);
    expect(summary.crashed).toEqual([]);
    expect(await exists(jobPaths(root, job.jobId).source)).toBe(false);
    expect(await readLock(root, "lte")).toBeNull();
  });

  it("should keep a READY job idle for exactly 24 h", async () => {
    const root = await roots.create();
    const job = await makeJob(root, { state: JOB_STATE.READY, now: NOW - READY_ABANDONED_MS });

    const summary = await sweepJobs(root, NOW, { isPidAlive: dead });

    expect(summary.abandonedReady).toEqual([]);
    expect((await readStatus(root, job.jobId))?.state).toBe(JOB_STATE.READY);
    expect(await exists(jobPaths(root, job.jobId).source)).toBe(true);
  });

  it("should measure READY idleness from the heartbeat when there is one", async () => {
    const root = await roots.create();
    const job = await makeJob(root, {
      state: JOB_STATE.READY,
      now: NOW - 2 * READY_ABANDONED_MS,
      mutate: (s) => (s.heartbeatAt = new Date(NOW - 1000).toISOString()),
    });

    const summary = await sweepJobs(root, NOW, { isPidAlive: dead });

    expect(summary.abandonedReady).toEqual([]);
    expect((await readStatus(root, job.jobId))?.state).toBe(JOB_STATE.READY);
  });

  it("should not touch an old READY job while a fresh start.lock marks a start in progress", async () => {
    const root = await roots.create();
    const job = await makeJob(root, { state: JOB_STATE.READY, now: NOW - 2 * READY_ABANDONED_MS });
    await putLock(root, job.jobId);
    await putStartMarker(root, job.jobId, START_MARKER_FRESH_MS - 1000);

    const summary = await sweepJobs(root, NOW, { isPidAlive: dead });

    expect(summary.abandonedReady).toEqual([]);
    expect((await readStatus(root, job.jobId))?.state).toBe(JOB_STATE.READY);
    expect(await exists(jobPaths(root, job.jobId).source)).toBe(true);
    expect((await readLock(root, "lte"))?.jobId).toBe(job.jobId);
  });

  it("should cancel an old READY job whose start.lock is no longer fresh", async () => {
    const root = await roots.create();
    const job = await makeJob(root, { state: JOB_STATE.READY, now: NOW - 2 * READY_ABANDONED_MS });
    await putStartMarker(root, job.jobId, START_MARKER_FRESH_MS + 1000);

    const summary = await sweepJobs(root, NOW, { isPidAlive: dead });

    expect(summary.abandonedReady).toEqual([job.jobId]);
    expect((await readStatus(root, job.jobId))?.state).toBe(JOB_STATE.CANCELLED);
  });

  it("should leave a lock owned by another job alone when it cancels an abandoned READY job", async () => {
    const root = await roots.create();
    const abandoned = await makeJob(root, { state: JOB_STATE.READY, table: "nbiot", now: NOW - 2 * READY_ABANDONED_MS });
    const other = await makeJob(root, { state: JOB_STATE.RUNNING, table: "lte", mutate: (s) => ((s.pid = 1), (s.heartbeatAt = new Date(NOW).toISOString())) });
    await putLock(root, other.jobId, "lte");

    await sweepJobs(root, NOW, { isPidAlive: alive });

    expect((await readLock(root, "lte"))?.jobId).toBe(other.jobId);
    expect((await readStatus(root, abandoned.jobId))?.state).toBe(JOB_STATE.CANCELLED);
  });
});

describe("sweepJobs stale locks of READY owners", () => {
  async function readyOwner(root: string, idleMs: number) {
    const job = await makeJob(root, { state: JOB_STATE.READY, now: NOW - idleMs });
    await putLock(root, job.jobId);
    return job;
  }

  it("should free the lock of a READY owner whose lock pid is dead once the READY grace passed, leaving the job READY", async () => {
    const root = await roots.create();
    const job = await readyOwner(root, READY_LOCK_GRACE_MS + 1000);

    const summary = await sweepJobs(root, NOW, { isPidAlive: dead });

    expect(await readLock(root, "lte")).toBeNull();
    expect(summary.locksRemoved).toEqual([job.jobId]);
    expect((await readStatus(root, job.jobId))?.state).toBe(JOB_STATE.READY);
  });

  it("should keep the lock of a READY owner younger than the grace", async () => {
    const root = await roots.create();
    const job = await readyOwner(root, READY_LOCK_GRACE_MS - 1000);

    await sweepJobs(root, NOW, { isPidAlive: dead });

    expect((await readLock(root, "lte"))?.jobId).toBe(job.jobId);
  });

  it("should keep the lock of a READY owner exactly at the grace boundary", async () => {
    const root = await roots.create();
    const job = await readyOwner(root, READY_LOCK_GRACE_MS);

    await sweepJobs(root, NOW, { isPidAlive: dead });

    expect((await readLock(root, "lte"))?.jobId).toBe(job.jobId);
  });

  it("should keep the lock of an old READY owner while the lock pid still answers", async () => {
    const root = await roots.create();
    const job = await readyOwner(root, 10 * READY_LOCK_GRACE_MS);

    await sweepJobs(root, NOW, { isPidAlive: alive });

    expect((await readLock(root, "lte"))?.jobId).toBe(job.jobId);
  });

  it("should keep the lock of an old READY owner with a dead pid while a fresh start.lock exists", async () => {
    const root = await roots.create();
    const job = await readyOwner(root, 10 * READY_LOCK_GRACE_MS);
    await putStartMarker(root, job.jobId, 1000);

    await sweepJobs(root, NOW, { isPidAlive: dead });

    expect((await readLock(root, "lte"))?.jobId).toBe(job.jobId);
  });

  it("should free the lock of an old READY owner with a dead pid when its start.lock is stale", async () => {
    const root = await roots.create();
    const job = await readyOwner(root, 10 * READY_LOCK_GRACE_MS);
    await putStartMarker(root, job.jobId, START_MARKER_FRESH_MS + 1000);

    await sweepJobs(root, NOW, { isPidAlive: dead });

    expect(await readLock(root, "lte")).toBeNull();
  });
});

describe("discardJob", () => {
  it("should return NOT_FOUND when there is no status", async () => {
    const root = await roots.create();
    expect(await discardJob(root, randomUUID())).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("should return NOT_FOUND for an invalid id without throwing", async () => {
    const root = await roots.create();
    expect(await discardJob(root, "../..")).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it.each([JOB_STATE.UPLOADING, JOB_STATE.READY, JOB_STATE.RUNNING, JOB_STATE.CANCELLING] as JobState[])(
    "should return NOT_TERMINAL and keep the folder when the job is %s",
    async (state) => {
      const root = await roots.create();
      const job = await makeJob(root, { state });

      expect(await discardJob(root, job.jobId)).toEqual({ ok: false, reason: "NOT_TERMINAL" });
      expect(await dirExists(jobPaths(root, job.jobId).dir)).toBe(true);
    }
  );

  it.each([JOB_STATE.SUCCEEDED, JOB_STATE.FAILED, JOB_STATE.CANCELLED] as JobState[])("should delete the folder of a %s job", async (state) => {
    const root = await roots.create();
    const job = await makeJob(root, { state });

    expect(await discardJob(root, job.jobId)).toEqual({ ok: true });
    expect(await dirExists(jobPaths(root, job.jobId).dir)).toBe(false);
  });
});
