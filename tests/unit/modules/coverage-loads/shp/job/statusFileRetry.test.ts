import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTmpRoots, makeJob } from "../helpers/jobTestEnv.ts";

const renameControl = vi.hoisted(() => ({ failures: [] as string[], calls: 0 }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      renameControl.calls += 1;
      const code = renameControl.failures.shift();
      if (code) throw Object.assign(new Error(`injected ${code}`), { code });
      return actual.rename(from, to);
    },
  };
});

const { readStatus, writeStatusAtomic } = await import("@/modules/coverage-loads/shp/job/statusFile.ts");

const roots = createTmpRoots();
beforeEach(() => {
  renameControl.failures = [];
  renameControl.calls = 0;
});
afterEach(() => roots.cleanup());

describe("writeStatusAtomic rename retry", () => {
  it.each(["EPERM", "EBUSY", "EACCES"])("should retry and succeed after a transient %s", async (code) => {
    const root = await roots.create();
    const { jobId, status } = await makeJob(root);
    renameControl.calls = 0;
    renameControl.failures = [code, code];
    status.progress.rowsCopied = 7;

    await writeStatusAtomic(root, jobId, JSON.stringify(status));

    expect(renameControl.calls).toBe(3);
    expect((await readStatus(root, jobId))?.progress.rowsCopied).toBe(7);
  });

  it("should succeed on the third retry (fourth attempt)", async () => {
    const root = await roots.create();
    const { jobId, status } = await makeJob(root);
    renameControl.calls = 0;
    renameControl.failures = ["EBUSY", "EBUSY", "EBUSY"];

    await writeStatusAtomic(root, jobId, JSON.stringify(status));

    expect(renameControl.calls).toBe(4);
  });

  it("should throw after more than 3 retries", async () => {
    const root = await roots.create();
    const { jobId, status } = await makeJob(root);
    renameControl.calls = 0;
    renameControl.failures = ["EPERM", "EPERM", "EPERM", "EPERM", "EPERM"];

    await expect(writeStatusAtomic(root, jobId, JSON.stringify(status))).rejects.toMatchObject({ code: "EPERM" });
    expect(renameControl.calls).toBe(4);
  });

  it("should not retry a non-retryable error", async () => {
    const root = await roots.create();
    const { jobId, status } = await makeJob(root);
    renameControl.calls = 0;
    renameControl.failures = ["ENOSPC"];

    await expect(writeStatusAtomic(root, jobId, JSON.stringify(status))).rejects.toMatchObject({ code: "ENOSPC" });
    expect(renameControl.calls).toBe(1);
  });

  it("should leave the previous status.json intact when the write finally fails", async () => {
    const root = await roots.create();
    const { jobId, status } = await makeJob(root);
    renameControl.failures = ["EBUSY", "EBUSY", "EBUSY", "EBUSY"];
    const changed = { ...status, progress: { ...status.progress, rowsCopied: 99 } };

    await expect(writeStatusAtomic(root, jobId, JSON.stringify(changed))).rejects.toThrow();

    expect((await readStatus(root, jobId))?.progress.rowsCopied).toBe(0);
  });
});
