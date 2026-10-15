import { afterEach, describe, expect, it, vi } from "vitest";
import { readStatus, writeStatusAtomic } from "@/modules/coverage-loads/shp/job/statusFile.ts";
import type { JobStatus } from "@/modules/coverage-loads/shp/job/types.ts";
import { createTmpRoots, makeJob } from "../helpers/jobTestEnv.ts";

vi.setConfig({ testTimeout: 60_000 });

const roots = createTmpRoots();
afterEach(() => roots.cleanup());

const JOBS = 8;
const WRITES_PER_JOB = 25;
const READER_PAUSE_MS = 2;

describe("status.json under writer/reader contention", () => {
  it("should complete 200 durable writes against concurrent readers with zero write failures and no unreadable file", async () => {
    const root = await roots.create();
    const jobs = await Promise.all(Array.from({ length: JOBS }, () => makeJob(root)));
    let writing = true;
    const unreadable: string[] = [];
    const regressions: string[] = [];
    let reads = 0;

    const reader = async (jobId: string): Promise<void> => {
      let last = -1;
      while (writing) {
        const status = await readStatus(root, jobId);
        reads += 1;
        if (status === null) unreadable.push(jobId);
        else {
          if (status.progress.rowsCopied < last) regressions.push(jobId);
          last = status.progress.rowsCopied;
        }
        await new Promise((resolve) => setTimeout(resolve, READER_PAUSE_MS));
      }
    };
    const writer = async (jobId: string, status: JobStatus): Promise<number> => {
      let failures = 0;
      for (let rows = 1; rows <= WRITES_PER_JOB; rows += 1) {
        status.progress.rowsCopied = rows;
        await writeStatusAtomic(root, jobId, JSON.stringify(status, null, 2), { durable: true }).catch(() => (failures += 1));
      }
      return failures;
    };

    const readers = jobs.flatMap((job) => [reader(job.jobId)]);
    const failures = await Promise.all(jobs.map((job) => writer(job.jobId, job.status)));
    writing = false;
    await Promise.all(readers);

    expect(failures.reduce((sum, count) => sum + count, 0)).toBe(0);
    expect(unreadable).toEqual([]);
    expect(regressions).toEqual([]);
    expect(reads).toBeGreaterThan(0);
    for (const job of jobs) expect((await readStatus(root, job.jobId))?.progress.rowsCopied).toBe(WRITES_PER_JOB);
  });
});
