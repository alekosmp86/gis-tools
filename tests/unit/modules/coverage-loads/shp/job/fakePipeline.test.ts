import { describe, expect, it, vi } from "vitest";
import { createFakePipeline } from "@/modules/coverage-loads/shp/job/fakePipeline.ts";
import { createRecordingContext } from "../helpers/jobTestContext.ts";
import { sleepMs, waitFor } from "../helpers/jobTestEnv.ts";

vi.setConfig({ testTimeout: 30_000 });

const LOAD_STAGES = ["READING", "STAGING", "SUBDIVIDING", "REPAIRING", "SWAPPING", "FINALIZING"];

describe("createFakePipeline", () => {
  it("should run the six stages in order and succeed with gates in LOAD mode", async () => {
    const rec = createRecordingContext("LOAD");

    const outcome = await createFakePipeline({ stageMs: 5 }).run(rec.context);

    expect(rec.stages).toEqual(LOAD_STAGES);
    expect(outcome).toMatchObject({ kind: "SUCCEEDED", gates: { passed: true } });
    expect(outcome).not.toHaveProperty("testReport");
  });

  it("should skip SWAPPING and return a test report in TEST mode", async () => {
    const rec = createRecordingContext("TEST");

    const outcome = await createFakePipeline({ stageMs: 5 }).run(rec.context);

    expect(rec.stages).toEqual(["READING", "STAGING", "SUBDIVIDING", "REPAIRING", "FINALIZING"]);
    expect(outcome).toMatchObject({ kind: "SUCCEEDED", testReport: { diff: { rows: 0 } } });
  });

  it("should report progress ending each stage at fraction 1", async () => {
    const rec = createRecordingContext();

    await createFakePipeline({ stageMs: 5 }).run(rec.context);

    expect(rec.progress.filter((p) => p.stageFraction === 1).length).toBeGreaterThanOrEqual(LOAD_STAGES.length);
    expect(rec.progress.some((p) => p.bytesRead === 1_000_000)).toBe(true);
    expect(rec.progress.some((p) => p.rowsCopied === 1000)).toBe(true);
    expect(rec.progress.some((p) => p.piecesRepaired === 40)).toBe(true);
  });

  it.each(["READING", "STAGING", "REPAIRING", "FINALIZING"] as const)("should fail at %s with FAKE_FAILURE and not run later stages", async (stage) => {
    const rec = createRecordingContext();

    const outcome = await createFakePipeline({ stageMs: 5, failAtStage: stage }).run(rec.context);

    expect(outcome).toEqual({ kind: "FAILED", error: { code: "FAKE_FAILURE", message: `Fallo simulado en la etapa ${stage}.` } });
    expect(rec.stages.at(-1)).toBe(stage);
    expect(rec.stages).toEqual(LOAD_STAGES.slice(0, LOAD_STAGES.indexOf(stage) + 1));
  });

  it("should ignore failAtStage SWAPPING in TEST mode because that stage never runs", async () => {
    const rec = createRecordingContext("TEST");

    const outcome = await createFakePipeline({ stageMs: 5, failAtStage: "SWAPPING" }).run(rec.context);

    expect(outcome.kind).toBe("SUCCEEDED");
  });

  it("should use per-stage durations, defaulting missing stages", async () => {
    const rec = createRecordingContext();

    const outcome = await createFakePipeline({ stageMs: { READING: 5, STAGING: 5, SUBDIVIDING: 5, REPAIRING: 5, SWAPPING: 5, FINALIZING: 5 } }).run(rec.context);

    expect(outcome.kind).toBe("SUCCEEDED");
    expect(rec.stages).toHaveLength(6);
  }, 30_000);

  it("should return CANCELLED when already aborted before the first stage", async () => {
    const rec = createRecordingContext();
    rec.abort.abort();

    const outcome = await createFakePipeline({ stageMs: 5 }).run(rec.context);

    expect(outcome).toEqual({ kind: "CANCELLED" });
    expect(rec.stages).toEqual([]);
  });

  it("should stop with CANCELLED soon after an abort mid-run", async () => {
    const rec = createRecordingContext();
    const run = createFakePipeline({ stageMs: 2000 }).run(rec.context);
    await sleepMs(50);

    rec.abort.abort();
    const outcome = await run;

    expect(outcome).toEqual({ kind: "CANCELLED" });
    expect(rec.stages).toEqual(["READING"]);
  });

  it("should end a held statement early when the registered cancel hook runs", async () => {
    const rec = createRecordingContext();
    const run = createFakePipeline({ stageMs: { STAGING: 20_000 }, holdStage: "STAGING" }).run(rec.context);
    await waitFor(() => rec.hooks.some((h) => h !== null));
    const hook = rec.hooks.find((h) => h !== null);
    expect(hook).toBeTypeOf("function");

    rec.abort.abort();
    await hook!();
    const outcome = await run;

    expect(outcome).toEqual({ kind: "CANCELLED" });
    expect(rec.hooks.at(-1)).toBeNull();
  });

  it("should hold a stage without progress updates while it waits", async () => {
    const rec = createRecordingContext();
    const run = createFakePipeline({ stageMs: { STAGING: 300 }, holdStage: "STAGING" }).run(rec.context);
    await waitFor(() => rec.stages.at(-1) === "STAGING");

    const during = rec.progress.length;
    await sleepMs(80);

    expect(rec.stages.at(-1)).toBe("STAGING");
    expect(rec.progress.length).toBe(during);
    rec.abort.abort();
    await run;
  });

  it("should keep holding when ignoreCancel is set, even after abort", async () => {
    const rec = createRecordingContext();
    const run = createFakePipeline({ stageMs: { STAGING: 300 }, holdStage: "STAGING", ignoreCancel: true }).run(rec.context);
    await waitFor(() => rec.stages.at(-1) === "STAGING");
    const startedAt = Date.now();

    rec.abort.abort();
    await run;

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(150);
    expect(rec.hooks.filter((h) => h !== null)).toEqual([]);
  });

  it("should return CANCELLED at the end when abort lands during the last stage's hold", async () => {
    const rec = createRecordingContext();
    const run = createFakePipeline({ stageMs: { FINALIZING: 200 }, holdStage: "FINALIZING", ignoreCancel: true }).run(rec.context);
    await waitFor(() => rec.stages.at(-1) === "FINALIZING");

    rec.abort.abort();

    expect(await run).toEqual({ kind: "CANCELLED" });
  });
});
