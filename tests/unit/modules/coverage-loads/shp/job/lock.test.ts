import { randomUUID } from "node:crypto";
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CORRUPT_LOCK_STALE_MS } from "@/modules/coverage-loads/shp/job/constants.ts";
import { lockPath, locksDir } from "@/modules/coverage-loads/shp/job/layout.ts";
import {
  acquireTableLock,
  isLockStale,
  readLock,
  releaseTableLock,
  TableLockHeldError,
  updateLockPid,
} from "@/modules/coverage-loads/shp/job/lock.ts";
import { JOB_STATE } from "@/modules/coverage-loads/shp/job/types.ts";
import { createTmpRoots, exists, makeJob } from "../helpers/jobTestEnv.ts";

const roots = createTmpRoots();
afterEach(() => roots.cleanup());

const NOW = Date.parse("2026-04-01T00:00:00.000Z");
const alive = () => true;
const dead = () => false;

async function writeLock(root: string, table: "lte" | "nbiot" | "wcdma" | "cobertura5g", jobId: string, pid = 1234): Promise<void> {
  await mkdir(locksDir(root), { recursive: true });
  await writeFile(lockPath(root, table), JSON.stringify({ table, jobId, pid, acquiredAt: new Date(NOW).toISOString() }));
}

describe("acquireTableLock", () => {
  it("should create locks/<table>.json with table, jobId, pid and acquiredAt", async () => {
    const root = await roots.create();
    const jobId = randomUUID();

    await acquireTableLock(root, "lte", { jobId, pid: 777 }, { now: () => NOW });

    const file = JSON.parse(await readFile(path.join(root, "locks", "lte.json"), "utf8"));
    expect(file).toEqual({ table: "lte", jobId, pid: 777, acquiredAt: new Date(NOW).toISOString() });
  });

  it("should throw a Spanish TableLockHeldError naming the table when a live owner holds it", async () => {
    const root = await roots.create();
    const owner = await makeJob(root, { table: "wcdma", state: JOB_STATE.RUNNING, mutate: (s) => ((s.pid = 5), (s.heartbeatAt = new Date(NOW).toISOString())) });
    await acquireTableLock(root, "wcdma", { jobId: owner.jobId, pid: 5 });

    const attempt = acquireTableLock(root, "wcdma", { jobId: randomUUID(), pid: 6 }, { now: () => NOW, isPidAlive: alive });

    await expect(attempt).rejects.toBeInstanceOf(TableLockHeldError);
    await expect(attempt).rejects.toThrow("Ya hay una carga de wcdma en curso.");
    await expect(attempt).rejects.toMatchObject({ table: "wcdma", name: "TableLockHeldError" });
  });

  it("should not steal a lock whose RUNNING owner is alive even with an old heartbeat", async () => {
    const root = await roots.create();
    const owner = await makeJob(root, { state: JOB_STATE.RUNNING, mutate: (s) => ((s.pid = 5), (s.heartbeatAt = new Date(NOW - 10 * CORRUPT_LOCK_STALE_MS).toISOString())) });
    await writeLock(root, "lte", owner.jobId, 5);

    await expect(acquireTableLock(root, "lte", { jobId: randomUUID(), pid: 6 }, { now: () => NOW, isPidAlive: alive })).rejects.toBeInstanceOf(TableLockHeldError);
    expect((await readLock(root, "lte"))?.jobId).toBe(owner.jobId);
  });

  it("should steal a lock whose owner has no status.json", async () => {
    const root = await roots.create();
    await writeLock(root, "lte", randomUUID());
    const thief = randomUUID();

    await acquireTableLock(root, "lte", { jobId: thief, pid: 9 }, { now: () => NOW });

    expect(await readLock(root, "lte")).toMatchObject({ jobId: thief, pid: 9 });
  });

  it.each([JOB_STATE.SUCCEEDED, JOB_STATE.FAILED, JOB_STATE.CANCELLED])("should steal a lock whose owner is %s", async (state) => {
    const root = await roots.create();
    const owner = await makeJob(root, { state });
    await writeLock(root, "lte", owner.jobId);
    const thief = randomUUID();

    await acquireTableLock(root, "lte", { jobId: thief, pid: 9 }, { now: () => NOW });

    expect((await readLock(root, "lte"))?.jobId).toBe(thief);
  });

  it("should steal a lock whose owner is RUNNING with a dead pid and stale heartbeat", async () => {
    const root = await roots.create();
    const owner = await makeJob(root, {
      state: JOB_STATE.RUNNING,
      mutate: (s) => ((s.pid = 5), (s.heartbeatAt = new Date(NOW - 10 * CORRUPT_LOCK_STALE_MS).toISOString())),
    });
    await writeLock(root, "lte", owner.jobId, 5);
    const thief = randomUUID();

    await acquireTableLock(root, "lte", { jobId: thief, pid: 9 }, { now: () => NOW, isPidAlive: dead });

    expect((await readLock(root, "lte"))?.jobId).toBe(thief);
  });

  it("should not steal from a RUNNING owner with a dead pid but a fresh heartbeat", async () => {
    const root = await roots.create();
    const owner = await makeJob(root, {
      state: JOB_STATE.RUNNING,
      mutate: (s) => ((s.pid = 5), (s.heartbeatAt = new Date(NOW - 1000).toISOString())),
    });
    await writeLock(root, "lte", owner.jobId, 5);

    await expect(acquireTableLock(root, "lte", { jobId: randomUUID(), pid: 9 }, { now: () => NOW, isPidAlive: dead })).rejects.toBeInstanceOf(TableLockHeldError);
  });

  it("should confirm and update the pid when the same job acquires again", async () => {
    const root = await roots.create();
    const jobId = randomUUID();
    await acquireTableLock(root, "lte", { jobId, pid: 1 });

    await acquireTableLock(root, "lte", { jobId, pid: 2 });

    expect(await readLock(root, "lte")).toMatchObject({ jobId, pid: 2 });
  });

  it("should keep a fresh corrupt lock (not stale yet) and throw", async () => {
    const root = await roots.create();
    await mkdir(locksDir(root), { recursive: true });
    await writeFile(lockPath(root, "lte"), "{not json");

    await expect(acquireTableLock(root, "lte", { jobId: randomUUID(), pid: 1 })).rejects.toBeInstanceOf(TableLockHeldError);
    expect(await exists(lockPath(root, "lte"))).toBe(true);
  });

  it("should steal a corrupt lock older than the stale window", async () => {
    const root = await roots.create();
    await mkdir(locksDir(root), { recursive: true });
    const file = lockPath(root, "lte");
    await writeFile(file, "{not json");
    const old = new Date(Date.now() - 10 * CORRUPT_LOCK_STALE_MS);
    await utimes(file, old, old);
    const thief = randomUUID();

    await acquireTableLock(root, "lte", { jobId: thief, pid: 1 });

    expect((await readLock(root, "lte"))?.jobId).toBe(thief);
  });

  it("should let exactly one of two simultaneous acquires win", async () => {
    const root = await roots.create();
    const a = (await makeJob(root, { table: "nbiot" })).jobId;
    const b = (await makeJob(root, { table: "nbiot" })).jobId;

    const results = await Promise.allSettled([
      acquireTableLock(root, "nbiot", { jobId: a, pid: 1 }),
      acquireTableLock(root, "nbiot", { jobId: b, pid: 2 }),
    ]);

    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(TableLockHeldError);
    expect((await readLock(root, "nbiot"))?.jobId).toBe([a, b][results.findIndex((r) => r.status === "fulfilled")]);
  });

  it("should allow different tables to be locked at once", async () => {
    const root = await roots.create();

    await acquireTableLock(root, "lte", { jobId: randomUUID(), pid: 1 });
    await expect(acquireTableLock(root, "wcdma", { jobId: randomUUID(), pid: 2 })).resolves.toBeUndefined();
  });

  it("should reject an invalid table", async () => {
    const root = await roots.create();
    await expect(acquireTableLock(root, "../x" as never, { jobId: randomUUID(), pid: 1 })).rejects.toThrow();
  });
});

describe("releaseTableLock", () => {
  it("should remove the lock only when the caller owns it", async () => {
    const root = await roots.create();
    const owner = randomUUID();
    await acquireTableLock(root, "lte", { jobId: owner, pid: 1 });

    expect(await releaseTableLock(root, "lte", randomUUID())).toBe(false);
    expect(await exists(lockPath(root, "lte"))).toBe(true);
    expect(await releaseTableLock(root, "lte", owner)).toBe(true);
    expect(await exists(lockPath(root, "lte"))).toBe(false);
  });

  it("should return false when there is no lock or it is corrupt", async () => {
    const root = await roots.create();
    expect(await releaseTableLock(root, "lte", randomUUID())).toBe(false);

    await mkdir(locksDir(root), { recursive: true });
    await writeFile(lockPath(root, "lte"), "garbage");
    expect(await releaseTableLock(root, "lte", randomUUID())).toBe(false);
  });
});

describe("readLock", () => {
  it.each([["garbage"], ["{}"], ['{"jobId":"a"}'], ['{"jobId":1,"pid":2}'], ["null"]])("should return null for malformed content %s", async (content) => {
    const root = await roots.create();
    await mkdir(locksDir(root), { recursive: true });
    await writeFile(lockPath(root, "lte"), content);

    expect(await readLock(root, "lte")).toBeNull();
  });
});

describe("updateLockPid", () => {
  it("should rewrite the lock with the new pid and acquiredAt", async () => {
    const root = await roots.create();
    const jobId = randomUUID();
    await acquireTableLock(root, "lte", { jobId, pid: 1 }, { now: () => NOW });

    await updateLockPid(root, "lte", { jobId, pid: 99 }, { now: () => NOW + 1000 });

    expect(await readLock(root, "lte")).toEqual({ table: "lte", jobId, pid: 99, acquiredAt: new Date(NOW + 1000).toISOString() });
  });
});

describe("isLockStale", () => {
  it("should treat a null lock with no file as stale", async () => {
    const root = await roots.create();
    expect(await isLockStale(root, null, "lte", { now: () => NOW })).toBe(true);
  });
});
