import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT_CODE } from "@/modules/coverage-loads/shp/job/constants.ts";
import type { JobSpawnConfig } from "@/modules/coverage-loads/shp/job/jobConfig.ts";
import { jobPaths } from "@/modules/coverage-loads/shp/job/layout.ts";
import { acquireTableLock, readLock } from "@/modules/coverage-loads/shp/job/lock.ts";
import { CANARY_CONNECTION, CANARY_DB, CANARY_HOST, CANARY_PASSWORD, CANARY_USER, createTmpRoots, exists, makeJob } from "../helpers/jobTestEnv.ts";

vi.setConfig({ testTimeout: 60_000 });

const control = vi.hoisted(() => ({ failTerminal: 0 as number | "always", lastTmpText: "", failedCalls: 0 }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: async (file: unknown, data: unknown, options?: unknown) => {
      if (typeof file === "string" && file.endsWith("status.json.tmp")) control.lastTmpText = String(data);
      return (actual.writeFile as (...args: unknown[]) => Promise<void>)(file, data, options);
    },
    rename: async (from: string, to: string) => {
      const terminal = to.endsWith("status.json") && /"state": "(SUCCEEDED|FAILED|CANCELLED)"/.test(control.lastTmpText);
      if (terminal && (control.failTerminal === "always" || control.failTerminal > 0)) {
        if (control.failTerminal !== "always") control.failTerminal -= 1;
        control.failedCalls += 1;
        const message = `ENOSPC: no space left, host ${CANARY_HOST} user ${CANARY_USER} db ${CANARY_DB} password ${CANARY_PASSWORD}`;
        throw Object.assign(new Error(message), { code: "ENOSPC" });
      }
      return actual.rename(from, to);
    },
  };
});

const { runJob } = await import("@/modules/coverage-loads/shp/job/runJob.ts");
const { readStatus } = await import("@/modules/coverage-loads/shp/job/statusFile.ts");

const roots = createTmpRoots();
beforeEach(() => {
  control.failTerminal = 0;
  control.lastTmpText = "";
  control.failedCalls = 0;
});
afterEach(() => roots.cleanup());

const FAST = { heartbeatMs: 10, cancelPollMs: 10, progressThrottleMs: 1 };

function configFor(jobId: string): JobSpawnConfig {
  return { jobId, mode: "LOAD", pipeline: "fake", fake: { stageMs: 5 }, connection: { ...CANARY_CONNECTION }, timing: FAST };
}

async function artefacts(root: string, jobId: string): Promise<{ log: string; status: string }> {
  const paths = jobPaths(root, jobId);
  return { log: await readFile(paths.log, "utf8").catch(() => ""), status: await readFile(paths.status, "utf8").catch(() => "") };
}

describe("runJob when the final status cannot be written", () => {
  it("should exit with STATUS_WRITE_FAILED (4), log ERROR lines, and release the table lock", async () => {
    const root = await roots.create();
    const job = await makeJob(root);
    control.failTerminal = "always";

    const code = await runJob(configFor(job.jobId), { rootDir: root });

    const { log, status } = await artefacts(root, job.jobId);
    expect(code).toBe(EXIT_CODE.STATUS_WRITE_FAILED);
    expect(EXIT_CODE.STATUS_WRITE_FAILED).toBe(4);
    expect(log.split("\n").filter((line) => line.includes(" ERROR "))).toHaveLength(2);
    expect(JSON.parse(status).state).toBe("RUNNING");
    expect(await readLock(root, "lte")).toBeNull();
    expect(await exists(jobPaths(root, job.jobId).source)).toBe(false);
  });

  it("should never write the password, host, user or database name to the log or the status", async () => {
    const root = await roots.create();
    const job = await makeJob(root);
    control.failTerminal = "always";

    await runJob(configFor(job.jobId), { rootDir: root });

    const { log, status } = await artefacts(root, job.jobId);
    for (const secret of [CANARY_PASSWORD, CANARY_HOST, CANARY_USER, CANARY_DB]) {
      expect(log).not.toContain(secret);
      expect(status).not.toContain(secret);
    }
    expect(log).toContain("ERROR");
  });

  it("should still release the lock owned by this job and leave other tables' locks alone", async () => {
    const root = await roots.create();
    const job = await makeJob(root);
    const other = await makeJob(root, { table: "wcdma" });
    await acquireTableLock(root, "wcdma", { jobId: other.jobId, pid: process.pid });
    control.failTerminal = "always";

    const code = await runJob(configFor(job.jobId), { rootDir: root });

    expect(code).toBe(EXIT_CODE.STATUS_WRITE_FAILED);
    expect(await readLock(root, "lte")).toBeNull();
    expect((await readLock(root, "wcdma"))?.jobId).toBe(other.jobId);
  });

  it("should exit 0 and finish SUCCEEDED when only the first terminal write fails (one ERROR line)", async () => {
    const root = await roots.create();
    const job = await makeJob(root);
    control.failTerminal = 1;

    const code = await runJob(configFor(job.jobId), { rootDir: root });

    const { log } = await artefacts(root, job.jobId);
    expect(code).toBe(EXIT_CODE.SUCCEEDED);
    expect((await readStatus(root, job.jobId))?.state).toBe("SUCCEEDED");
    expect(log.split("\n").filter((line) => line.includes(" ERROR "))).toHaveLength(1);
    expect(await readLock(root, "lte")).toBeNull();
  });
});
