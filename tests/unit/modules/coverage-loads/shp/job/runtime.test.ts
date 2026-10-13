import { readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePipeline } from "@/modules/coverage-loads/shp/job/fakePipeline.ts";
import { jobPaths } from "@/modules/coverage-loads/shp/job/layout.ts";
import { createJobRuntime, DEFAULT_TIMING } from "@/modules/coverage-loads/shp/job/runtime.ts";
import type { JobRuntime, JobRuntimeOptions, TimerApi } from "@/modules/coverage-loads/shp/job/runtime.ts";
import { createScrubber } from "@/modules/coverage-loads/shp/job/scrub.ts";
import { readStatus } from "@/modules/coverage-loads/shp/job/statusFile.ts";
import { CANARY_CONNECTION, CANARY_PASSWORD, createTmpRoots, makeJob, sleepMs, waitFor } from "../helpers/jobTestEnv.ts";

vi.setConfig({ testTimeout: 30_000 });

const roots = createTmpRoots();
const runtimes: JobRuntime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    runtime.stopTimers();
    await runtime.close();
  }
  await roots.cleanup();
});

async function setup(options: Partial<JobRuntimeOptions> = {}, mode: "LOAD" | "TEST" = "LOAD") {
  const root = await roots.create();
  const job = await makeJob(root, { mode });
  const runtime = createJobRuntime({
    rootDir: root,
    status: job.status,
    connection: CANARY_CONNECTION,
    scrub: createScrubber([CANARY_PASSWORD]),
    ...options,
  });
  runtimes.push(runtime);
  return { root, job, runtime, paths: jobPaths(root, job.jobId) };
}

describe("createJobRuntime begin", () => {
  it("should move READY to RUNNING with pid, node version and heartbeat, persisted to disk", async () => {
    const now = Date.parse("2026-06-01T00:00:00.000Z");
    const { root, job, runtime } = await setup({ now: () => now });

    await runtime.begin(4321, "v24.0.0");

    const onDisk = await readStatus(root, job.jobId);
    expect(onDisk).toMatchObject({ state: "RUNNING", pid: 4321, nodeVersion: "v24.0.0", startedAt: new Date(now).toISOString(), heartbeatAt: new Date(now).toISOString() });
  });

  it("should expose default timing merged with overrides", async () => {
    const { runtime } = await setup({ timing: { heartbeatMs: 33 } });

    expect(runtime.timing).toEqual({ ...DEFAULT_TIMING, heartbeatMs: 33 });
  });

  it("should expose the context built from the status", async () => {
    const { runtime, job, paths } = await setup({}, "TEST");

    expect(runtime.context.mode).toBe("TEST");
    expect(runtime.context.target).toEqual(job.status.target);
    expect(runtime.context.sourcePath).toBe(paths.source);
    expect(runtime.context.signal.aborted).toBe(false);
  });
});

describe("heartbeat independence", () => {
  it("should keep advancing heartbeatAt while a pipeline step awaits a long promise without progress", async () => {
    const { root, job, runtime } = await setup({ timing: { heartbeatMs: 25, cancelPollMs: 1000 } });
    await runtime.begin(1, "v24");
    runtime.startTimers();
    const first = (await readStatus(root, job.jobId))!.heartbeatAt!;
    runtime.context.setStage("STAGING");
    const held = sleepMs(300);

    const seen = new Set<string>();
    for (let i = 0; i < 12; i += 1) {
      await sleepMs(25);
      const beat = (await readStatus(root, job.jobId))?.heartbeatAt;
      if (beat) seen.add(beat);
    }
    await held;

    const beats = [...seen].sort();
    expect(beats.length).toBeGreaterThanOrEqual(3);
    expect(Date.parse(beats.at(-1)!)).toBeGreaterThan(Date.parse(first));
    expect(beats).toEqual([...new Set(beats)]);
  });

  it("should stop heartbeating after stopTimers", async () => {
    const { root, job, runtime } = await setup({ timing: { heartbeatMs: 15, cancelPollMs: 1000 } });
    await runtime.begin(1, "v24");
    runtime.startTimers();
    await sleepMs(80);

    runtime.stopTimers();
    await sleepMs(60);
    const afterStop = (await readStatus(root, job.jobId))!.heartbeatAt;
    await sleepMs(100);

    expect((await readStatus(root, job.jobId))!.heartbeatAt).toBe(afterStop);
  });

  it("should use the injected timer API with the configured intervals", async () => {
    const calls: number[] = [];
    const cleared: unknown[] = [];
    const timers: TimerApi = {
      setInterval: (_cb, ms) => (calls.push(ms), calls.length),
      clearInterval: (handle) => cleared.push(handle),
    };
    const { runtime } = await setup({ timers, timing: { heartbeatMs: 111, cancelPollMs: 222 } });

    runtime.startTimers();
    runtime.stopTimers();
    runtime.stopTimers();

    expect(calls).toEqual([111, 222]);
    expect(cleared).toEqual([1, 2]);
  });
});

describe("cancel observation", () => {
  it("should observe cancel.request: CANCELLING, abort signal, hook once, cancelObserved resolved", async () => {
    const { root, job, runtime, paths } = await setup({ timing: { heartbeatMs: 1000, cancelPollMs: 20 } });
    await runtime.begin(1, "v24");
    const hook = vi.fn();
    runtime.context.registerOnCancel(hook);
    runtime.startTimers();

    await writeFile(paths.cancel, "");
    await runtime.cancelObserved;
    await sleepMs(100);

    expect(runtime.context.signal.aborted).toBe(true);
    expect(runtime.isCancelRequested()).toBe(true);
    expect(hook).toHaveBeenCalledTimes(1);
    await waitFor(async () => (await readStatus(root, job.jobId))?.state === "CANCELLING");
    expect((await readStatus(root, job.jobId))?.cancelRequested).toBe(true);
  });

  it("should not observe a cancel when no cancel.request exists", async () => {
    const { runtime } = await setup({ timing: { heartbeatMs: 1000, cancelPollMs: 10 } });
    await runtime.begin(1, "v24");
    runtime.startTimers();

    await sleepMs(100);

    expect(runtime.isCancelRequested()).toBe(false);
    expect(runtime.context.signal.aborted).toBe(false);
  });

  it("should run a hook registered after the cancel was already observed", async () => {
    const { runtime, paths } = await setup({ timing: { heartbeatMs: 1000, cancelPollMs: 10 } });
    await runtime.begin(1, "v24");
    runtime.startTimers();
    await writeFile(paths.cancel, "");
    await runtime.cancelObserved;
    const late = vi.fn();

    runtime.context.registerOnCancel(late);
    await sleepMs(20);

    expect(late).toHaveBeenCalledTimes(1);
  });

  it("should not call a cleared hook", async () => {
    const { runtime, paths } = await setup({ timing: { heartbeatMs: 1000, cancelPollMs: 10 } });
    await runtime.begin(1, "v24");
    const hook = vi.fn();
    runtime.context.registerOnCancel(hook);
    runtime.context.registerOnCancel(null);
    runtime.startTimers();

    await writeFile(paths.cancel, "");
    await runtime.cancelObserved;
    await sleepMs(30);

    expect(hook).not.toHaveBeenCalled();
  });

  it("should log a warning and keep going when the hook throws", async () => {
    const { runtime, paths } = await setup({ timing: { heartbeatMs: 1000, cancelPollMs: 10 } });
    await runtime.begin(1, "v24");
    runtime.context.registerOnCancel(() => {
      throw new Error(`hook boom ${CANARY_PASSWORD}`);
    });
    runtime.startTimers();
    await writeFile(paths.cancel, "");
    await runtime.cancelObserved;
    await sleepMs(50);
    runtime.stopTimers();
    await runtime.close();

    const log = await readFile(paths.log, "utf8");
    expect(log).toContain("WARN El gancho de cancelación falló: hook boom ***");
    expect(log).not.toContain(CANARY_PASSWORD);
  });

  it("should use an injected cancel probe and survive its failure", async () => {
    const probe = vi.fn().mockRejectedValueOnce(new Error("probe failed")).mockResolvedValue(true);
    const { runtime } = await setup({ cancelRequested: probe, timing: { heartbeatMs: 1000, cancelPollMs: 10 } });
    await runtime.begin(1, "v24");
    runtime.startTimers();

    await runtime.cancelObserved;

    expect(probe.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(runtime.isCancelRequested()).toBe(true);
  });

  it("should end with exactly one observation and one hook call across many polls", async () => {
    const { runtime, paths } = await setup({ timing: { heartbeatMs: 1000, cancelPollMs: 5 } });
    await runtime.begin(1, "v24");
    const hook = vi.fn();
    runtime.context.registerOnCancel(hook);
    await writeFile(paths.cancel, "");
    runtime.startTimers();

    await runtime.cancelObserved;
    await sleepMs(100);

    expect(hook).toHaveBeenCalledTimes(1);
  });
});

describe("progress and stages", () => {
  it("should persist setStage immediately", async () => {
    const { root, job, runtime } = await setup();
    await runtime.begin(1, "v24");

    runtime.context.setStage("READING");

    await waitFor(async () => (await readStatus(root, job.jobId))?.stage === "READING");
  });

  it("should throttle progress writes: many updates inside the window write at most once", async () => {
    let clock = 1_000_000;
    const { root, job, runtime } = await setup({ now: () => clock, timing: { progressThrottleMs: 1000 } });
    await runtime.begin(1, "v24");
    clock += 5000;
    runtime.context.updateProgress({ rowsCopied: 1 });
    await sleepMs(80);
    expect((await readStatus(root, job.jobId))?.progress.rowsCopied).toBe(1);

    for (let i = 2; i <= 50; i += 1) {
      clock += 1;
      runtime.context.updateProgress({ rowsCopied: i });
    }
    await sleepMs(80);

    expect((await readStatus(root, job.jobId))?.progress.rowsCopied).toBe(1);
    expect(runtime.snapshot().progress.rowsCopied).toBe(50);

    clock += 1000;
    runtime.context.updateProgress({ rowsCopied: 51 });
    await waitFor(async () => (await readStatus(root, job.jobId))?.progress.rowsCopied === 51);
  });
});

describe("complete", () => {
  it.each([
    ["SUCCEEDED", { kind: "SUCCEEDED" as const }],
    ["CANCELLED", { kind: "CANCELLED" as const }],
    ["FAILED", { kind: "FAILED" as const, error: { code: "E", message: "m" } }],
  ])("should write the terminal state %s to disk", async (state, outcome) => {
    const { root, job, runtime } = await setup();
    await runtime.begin(1, "v24");
    runtime.context.setStage("READING");

    const final = await runtime.complete(outcome);

    expect(final.state).toBe(state);
    expect((await readStatus(root, job.jobId))?.state).toBe(state);
  });

  it("should scrub secrets from a failure message before persisting it", async () => {
    const { root, job, runtime } = await setup();
    await runtime.begin(1, "v24");

    await runtime.complete({ kind: "FAILED", error: { code: "E", message: `login failed for ${CANARY_PASSWORD}` } });

    const text = await readFile(jobPaths(root, job.jobId).status, "utf8");
    expect(text).not.toContain(CANARY_PASSWORD);
    expect(JSON.parse(text).error.message).toBe("login failed for ***");
  });
});

describe("job log", () => {
  it("should write ISO-timestamped LEVEL lines, scrubbed, and flush on close", async () => {
    const now = Date.parse("2026-07-01T08:09:10.123Z");
    const { runtime, paths } = await setup({ now: () => now });

    runtime.log("INFO", "hola");
    runtime.log("ERROR", `fallo con ${CANARY_PASSWORD}`);
    runtime.log("WARN", "linea1\nlinea2\r\nlinea3");
    await runtime.close();

    const lines = (await readFile(paths.log, "utf8")).split("\n");
    expect(lines[0]).toBe("2026-07-01T08:09:10.123Z INFO hola");
    expect(lines[1]).toBe("2026-07-01T08:09:10.123Z ERROR fallo con ***");
    expect(lines[2]).toBe("2026-07-01T08:09:10.123Z WARN linea1 | linea2 | linea3");
    expect(lines[3]).toBe("");
  });

  it("should keep every line in order under rapid logging", async () => {
    const { runtime, paths } = await setup();

    for (let i = 0; i < 100; i += 1) runtime.log("INFO", `line ${i}`);
    await runtime.close();

    const lines = (await readFile(paths.log, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(100);
    expect(lines.map((l) => l.split(" INFO ")[1])).toEqual(Array.from({ length: 100 }, (_v, i) => `line ${i}`));
  });
});

describe("runtime with the fake pipeline", () => {
  it("should let the pipeline drive stages and progress end to end", async () => {
    const { root, job, runtime } = await setup({ timing: { heartbeatMs: 10, cancelPollMs: 10, progressThrottleMs: 1 } });
    await runtime.begin(1, "v24");
    runtime.startTimers();

    const outcome = await createFakePipeline({ stageMs: 10 }).run(runtime.context);
    runtime.stopTimers();
    const final = await runtime.complete(outcome);

    expect(final.state).toBe("SUCCEEDED");
    const onDisk = await readStatus(root, job.jobId);
    expect(onDisk?.progress.overallFraction).toBe(1);
    expect(onDisk?.stages.map((s) => s.state)).toEqual(["DONE", "DONE", "DONE", "DONE", "DONE", "DONE", "DONE"]);
  });
});
