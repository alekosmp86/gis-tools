import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EXIT_CODE } from "./constants.ts";
import { jobPaths, newJobId } from "./layout.ts";
import { readStatus, writeStatusAtomic } from "./statusFile.ts";
import { createInitialStatus } from "./statusTransitions.ts";
import { runJob } from "./runJob.ts";
import { JOB_MODE, JOB_STATE } from "./types.ts";
import type { JobSpawnConfig } from "./jobConfig.ts";

const SELF_TEST_DATE = "2026-01-31";
const SELF_TEST_FILE = "LTEUruguay_20260131.shp";

/** Runs a tiny fake job in a temp dir: proves type stripping, imports, timers and cleanup work. */
export async function runSelfTest(): Promise<boolean> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "shp-job-selftest-"));
  try {
    const jobId = newJobId();
    const paths = jobPaths(rootDir, jobId);
    await mkdir(paths.dir, { recursive: true });
    await writeFile(paths.source, "x");
    const status = createInitialStatus({
      jobId,
      mode: JOB_MODE.LOAD,
      table: "lte",
      prefix: "LTEUruguay",
      fechaact: SELF_TEST_DATE,
      fileName: SELF_TEST_FILE,
      sizeBytes: 1,
      receivedBytes: 1,
      now: Date.now(),
      state: JOB_STATE.READY,
    });
    await writeStatusAtomic(rootDir, jobId, JSON.stringify(status));
    const config: JobSpawnConfig = {
      jobId,
      mode: JOB_MODE.LOAD,
      pipeline: "fake",
      fake: { stageMs: 20 },
      connection: { host: "self-test-host", port: 5432, db_name: "self-test-db", user: "self-test-user", password: "self-test-secret" },
      timing: { heartbeatMs: 10, cancelPollMs: 10 },
    };
    const exitCode = await runJob(config, { rootDir });
    const [final, locks] = await Promise.all([
      readStatus(rootDir, jobId),
      readdir(path.join(rootDir, "locks")).catch(() => ["?"]),
    ]);
    return exitCode === EXIT_CODE.SUCCEEDED && final?.state === JOB_STATE.SUCCEEDED && locks.length === 0;
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}
