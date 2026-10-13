import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTmpRoots, makeJob } from "../helpers/jobTestEnv.ts";
import { JOB_STATE } from "@/modules/coverage-loads/shp/job/types.ts";

const control = vi.hoisted(() => ({
  /** Runs right after an exclusive (wx) write to a lock file succeeded, simulating a rival stealer. */
  afterExclusiveLockWrite: null as null | ((file: string) => Promise<void>),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: async (file: unknown, data: unknown, options?: unknown) => {
      await (actual.writeFile as (...args: unknown[]) => Promise<void>)(file, data, options);
      const flag = typeof options === "object" && options !== null ? (options as { flag?: string }).flag : undefined;
      if (flag === "wx" && typeof file === "string" && file.endsWith(".json") && control.afterExclusiveLockWrite) {
        const hook = control.afterExclusiveLockWrite;
        control.afterExclusiveLockWrite = null;
        await hook(file);
      }
    },
  };
});

const { acquireTableLock, readLock, TableLockHeldError } = await import("@/modules/coverage-loads/shp/job/lock.ts");
const { lockPath, locksDir } = await import("@/modules/coverage-loads/shp/job/layout.ts");
const fsp = await import("node:fs/promises");

const roots = createTmpRoots();
const NOW = Date.parse("2026-04-01T00:00:00.000Z");

beforeEach(() => {
  control.afterExclusiveLockWrite = null;
});
afterEach(() => roots.cleanup());

async function seedStaleLock(root: string): Promise<string> {
  const staleOwner = (await makeJob(root, { state: JOB_STATE.SUCCEEDED })).jobId;
  await fsp.mkdir(locksDir(root), { recursive: true });
  await fsp.writeFile(lockPath(root, "lte"), JSON.stringify({ table: "lte", jobId: staleOwner, pid: 1, acquiredAt: new Date(NOW).toISOString() }));
  return staleOwner;
}

describe("acquireTableLock steal confirmation", () => {
  it("should throw TableLockHeldError when a rival overwrote the lock right after our exclusive create", async () => {
    const root = await roots.create();
    await seedStaleLock(root);
    const rival = randomUUID();
    const me = randomUUID();
    control.afterExclusiveLockWrite = async (file) => {
      await fsp.writeFile(file, JSON.stringify({ table: "lte", jobId: rival, pid: 2, acquiredAt: new Date(NOW).toISOString() }));
    };

    await expect(acquireTableLock(root, "lte", { jobId: me, pid: 9 }, { now: () => NOW })).rejects.toBeInstanceOf(TableLockHeldError);

    expect((await readLock(root, "lte"))?.jobId).toBe(rival);
  });

  it("should succeed and keep its own lock when nobody interferes with the steal", async () => {
    const root = await roots.create();
    await seedStaleLock(root);
    const me = randomUUID();

    await acquireTableLock(root, "lte", { jobId: me, pid: 9 }, { now: () => NOW });

    expect(await readLock(root, "lte")).toMatchObject({ jobId: me, pid: 9 });
  });

  it("should let exactly one of many concurrent stealers of a stale lock end up owning it", async () => {
    const root = await roots.create();
    await seedStaleLock(root);
    const contenders = Array.from({ length: 8 }, () => randomUUID());

    const results = await Promise.allSettled(contenders.map((jobId) => acquireTableLock(root, "lte", { jobId, pid: 9 }, { now: () => NOW })));

    const winners = contenders.filter((_, index) => results[index].status === "fulfilled");
    expect(winners).toHaveLength(1);
    expect((await readLock(root, "lte"))?.jobId).toBe(winners[0]);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toBeInstanceOf(TableLockHeldError);
    }
  });
});
