import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STATUS_FINAL_WRITE_ATTEMPTS } from "@/modules/coverage-loads/shp/job/constants.ts";
import { jobPaths } from "@/modules/coverage-loads/shp/job/layout.ts";
import type { JobRuntime, JobRuntimeOptions, TimerApi } from "@/modules/coverage-loads/shp/job/runtime.ts";
import { CANARY_CONNECTION, CANARY_PASSWORD, createTmpRoots, makeJob, sleepMs } from "../helpers/jobTestEnv.ts";

vi.setConfig({ testTimeout: 60_000 });

const control = vi.hoisted(() => ({
  /** Fails status renames: a number fails that many upcoming calls, "always" fails every call. */
  failures: 0 as number | "always",
  code: "ENOSPC",
  message: "",
  lastTmpText: "",
  failedCalls: 0,
  terminalOnly: false,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: async (file: unknown, data: unknown, options?: unknown) => {
      if (typeof file === "string" && file.endsWith("status.json.tmp")) control.lastTmpText = String(data);
      return (actual.writeFile as (...args: unknown[]) => Promise<void>)(file, data, options);
    },
    rename: async (from: string, to: string) => {
      const isStatus = to.endsWith("status.json");
      const terminal = /"state": "(SUCCEEDED|FAILED|CANCELLED)"/.test(control.lastTmpText);
      const applies = isStatus && (!control.terminalOnly || terminal);
      if (applies && (control.failures === "always" || control.failures > 0)) {
        if (control.failures !== "always") control.failures -= 1;
        control.failedCalls += 1;
        throw Object.assign(new Error(control.message || `injected ${control.code}`), { code: control.code });
      }
      return actual.rename(from, to);
    },
  };
});

const { createJobRuntime, FinalStatusWriteError } = await import("@/modules/coverage-loads/shp/job/runtime.ts");
const { createScrubber } = await import("@/modules/coverage-loads/shp/job/scrub.ts");
const { readStatus } = await import("@/modules/coverage-loads/shp/job/statusFile.ts");

const roots = createTmpRoots();
const runtimes: JobRuntime[] = [];

beforeEach(() => {
  control.failures = 0;
  control.code = "ENOSPC";
  control.message = "";
  control.lastTmpText = "";
  control.failedCalls = 0;
  control.terminalOnly = false;
});
afterEach(async () => {
  control.failures = 0;
  for (const runtime of runtimes.splice(0)) {
    runtime.stopTimers();
    await runtime.close();
  }
  await roots.cleanup();
});

interface CapturedTimers extends TimerApi {
  callbacks: Array<() => void>;
}

function capturingTimers(): CapturedTimers {
  const callbacks: Array<() => void> = [];
  return {
    callbacks,
    setInterval: (callback) => (callbacks.push(callback), callbacks.length),
    clearInterval: () => undefined,
  };
}

async function setup(options: Partial<JobRuntimeOptions> = {}) {
  const root = await roots.create();
  const job = await makeJob(root);
  const runtime = createJobRuntime({
    rootDir: root,
    status: job.status,
    connection: CANARY_CONNECTION,
    scrub: createScrubber([CANARY_PASSWORD]),
    ...options,
  });
  runtimes.push(runtime);
  const paths = jobPaths(root, job.jobId);
  const logText = async (): Promise<string> => {
    await runtime.close();
    return readFile(paths.log, "utf8").catch(() => "");
  };
  return { root, job, runtime, paths, logText };
}

const errorLines = (log: string): string[] => log.split("\n").filter((line) => line.includes(" ERROR "));

describe("runtime final status write", () => {
  it("should succeed and log one ERROR when the terminal write fails once and then works", async () => {
    const { root, job, runtime, logText } = await setup();
    await runtime.begin(1, "v24");
    control.terminalOnly = true;
    control.failures = 1;

    const final = await runtime.complete({ kind: "SUCCEEDED" });

    expect(final.state).toBe("SUCCEEDED");
    expect((await readStatus(root, job.jobId))?.state).toBe("SUCCEEDED");
    expect(errorLines(await logText())).toHaveLength(1);
  });

  it("should throw FinalStatusWriteError after STATUS_FINAL_WRITE_ATTEMPTS failed terminal writes, logging ERROR each time", async () => {
    const { root, job, runtime, logText } = await setup();
    await runtime.begin(1, "v24");
    control.terminalOnly = true;
    control.failures = "always";

    await expect(runtime.complete({ kind: "SUCCEEDED" })).rejects.toBeInstanceOf(FinalStatusWriteError);

    expect(control.failedCalls).toBe(STATUS_FINAL_WRITE_ATTEMPTS);
    expect(errorLines(await logText())).toHaveLength(STATUS_FINAL_WRITE_ATTEMPTS);
    expect((await readStatus(root, job.jobId))?.state).toBe("RUNNING");
  });

  it("should name the error FinalStatusWriteError", async () => {
    const { runtime } = await setup();
    await runtime.begin(1, "v24");
    control.terminalOnly = true;
    control.failures = "always";

    const error = await runtime.complete({ kind: "CANCELLED" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("FinalStatusWriteError");
  });

  it("should never write the password into the log when the failing write error contains it", async () => {
    const { runtime, logText } = await setup();
    await runtime.begin(1, "v24");
    control.terminalOnly = true;
    control.failures = "always";
    control.message = `ENOSPC writing status for ${CANARY_PASSWORD}`;

    await runtime.complete({ kind: "FAILED", error: { code: "E", message: `boom ${CANARY_PASSWORD}` } }).catch(() => undefined);

    const log = await logText();
    expect(errorLines(log).length).toBeGreaterThan(0);
    expect(log).not.toContain(CANARY_PASSWORD);
  });

  it.each(["EPERM", "EBUSY", "EACCES"])("should ride out more than 3 transient %s failures on the terminal write without logging an error", async (code) => {
    const { root, job, runtime, logText } = await setup();
    await runtime.begin(1, "v24");
    control.terminalOnly = true;
    control.code = code;
    control.failures = 5;

    const final = await runtime.complete({ kind: "CANCELLED" });

    expect(final.state).toBe("CANCELLED");
    expect((await readStatus(root, job.jobId))?.state).toBe("CANCELLED");
    expect(errorLines(await logText())).toHaveLength(0);
  });
});

describe("runtime begin is durable", () => {
  it("should survive more than 3 transient EBUSY failures and persist RUNNING", async () => {
    const { root, job, runtime } = await setup();
    control.code = "EBUSY";
    control.failures = 5;

    await runtime.begin(99, "v24");

    expect((await readStatus(root, job.jobId))?.state).toBe("RUNNING");
    expect(control.failedCalls).toBe(5);
  });
});

describe("runtime quiet writes", () => {
  it.each(["ENOSPC", "EBUSY"])("should swallow and log a failing heartbeat write (%s) without rejecting", async (code) => {
    const timers = capturingTimers();
    const { runtime, logText } = await setup({ timers, timing: { heartbeatMs: 1000, cancelPollMs: 1000 } });
    await runtime.begin(1, "v24");
    runtime.startTimers();
    const [heartbeat] = timers.callbacks;
    control.code = code;
    control.failures = "always";

    expect(() => {
      heartbeat();
      heartbeat();
      heartbeat();
    }).not.toThrow();
    await sleepMs(500);
    control.failures = 0;
    const final = await runtime.complete({ kind: "SUCCEEDED" });

    expect(final.state).toBe("SUCCEEDED");
    expect(control.failedCalls).toBeGreaterThan(0);
    expect(await logText()).toContain(" WARN No se pudo escribir status.json");
  });

  it("should swallow failing progress and stage writes and keep the in-memory status current", async () => {
    const { runtime, logText } = await setup({ timing: { progressThrottleMs: 0 } });
    await runtime.begin(1, "v24");
    control.failures = "always";

    expect(() => {
      runtime.context.setStage("READING");
      runtime.context.updateProgress({ rowsCopied: 10 });
      runtime.context.updateProgress({ rowsCopied: 20 });
    }).not.toThrow();
    await sleepMs(200);
    control.failures = 0;
    const final = await runtime.complete({ kind: "SUCCEEDED" });

    expect(final.progress.rowsCopied).toBe(20);
    expect(await logText()).toContain(" WARN No se pudo escribir status.json");
  });

  it("should keep heartbeating after an earlier heartbeat write failed", async () => {
    const timers = capturingTimers();
    let clock = Date.parse("2026-06-01T00:00:00.000Z");
    const { root, job, runtime } = await setup({ timers, now: () => clock, timing: { heartbeatMs: 1000, cancelPollMs: 1000 } });
    await runtime.begin(1, "v24");
    runtime.startTimers();
    const [heartbeat] = timers.callbacks;
    control.failures = 1;
    heartbeat();
    await sleepMs(200);
    clock += 5000;

    heartbeat();
    await sleepMs(200);

    expect(control.failedCalls).toBe(1);
    expect((await readStatus(root, job.jobId))?.heartbeatAt).toBe(new Date(clock).toISOString());
  });
});
