import type { JobContext, JobPipeline, PipelineOutcome } from "./pipeline.ts";
import { JOB_MODE, JOB_STAGE, LOG_LEVEL } from "./types.ts";
import type { JobGates, JobProgress, JobStageId, TestReport } from "./types.ts";

/** Test double for the real pipeline. It never opens a connection and never touches the network. */
export interface FakeConfig {
  /** Milliseconds per stage: one number for all, or per-stage overrides (missing stage = 50). */
  stageMs: number | Partial<Record<JobStageId, number>>;
  failAtStage?: JobStageId;
  /** This stage is one long "statement": it awaits without touching progress (proves the timers are independent). */
  holdStage?: JobStageId;
  /** With `holdStage`: the statement ignores abort and the cancel hook (proves the hard-kill grace). */
  ignoreCancel?: boolean;
}

const DEFAULT_STAGE_MS = 50;
const TICKS_PER_STAGE = 5;
const FAKE_BYTES = 1_000_000;
const FAKE_ROWS = 1000;
const FAKE_PIECES = 40;

const FAKE_STAGES: readonly JobStageId[] = [
  JOB_STAGE.READING,
  JOB_STAGE.STAGING,
  JOB_STAGE.SUBDIVIDING,
  JOB_STAGE.REPAIRING,
  JOB_STAGE.SWAPPING,
  JOB_STAGE.FINALIZING,
];

const FAKE_GATES: JobGates = { stagingRows: FAKE_ROWS, maxVertices: 90, invalidPieces: 0, areaRelativeDiff: 0, passed: true };
const FAKE_TEST_REPORT: TestReport = {
  current: { rows: FAKE_ROWS, vertices: 5000, area: 10 },
  new: { rows: FAKE_ROWS, vertices: 5000, area: 10 },
  diff: { rows: 0, vertices: 0, area: 0 },
};

function stageDuration(config: FakeConfig, stage: JobStageId): number {
  if (typeof config.stageMs === "number") return config.stageMs;
  return config.stageMs[stage] ?? DEFAULT_STAGE_MS;
}

function progressFor(stage: JobStageId, fraction: number): Partial<JobProgress> {
  const base: Partial<JobProgress> = { stageFraction: fraction };
  if (stage === JOB_STAGE.READING) return { ...base, bytesTotal: FAKE_BYTES, bytesRead: Math.round(FAKE_BYTES * fraction) };
  if (stage === JOB_STAGE.STAGING) return { ...base, rowsCopied: Math.round(FAKE_ROWS * fraction) };
  if (stage === JOB_STAGE.SUBDIVIDING) return { ...base, piecesTotal: Math.round(FAKE_PIECES * fraction) };
  if (stage === JOB_STAGE.REPAIRING) return { ...base, piecesRepaired: Math.round(FAKE_PIECES * fraction) };
  return base;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** One long statement: no progress updates; a cancel hook (simulating pg_cancel_backend) ends it early. */
async function runHeldStatement(context: JobContext, ms: number, ignoreCancel: boolean): Promise<void> {
  if (ignoreCancel) return sleep(ms);
  await new Promise<void>((resolve) => {
    context.registerOnCancel(resolve);
    void sleep(ms, context.signal).then(resolve);
  });
  context.registerOnCancel(null);
}

async function runTickedStage(context: JobContext, stage: JobStageId, ms: number): Promise<void> {
  for (let tick = 1; tick <= TICKS_PER_STAGE && !context.signal.aborted; tick += 1) {
    await sleep(ms / TICKS_PER_STAGE, context.signal);
    context.updateProgress(progressFor(stage, tick / TICKS_PER_STAGE));
  }
}

function failure(stage: JobStageId): PipelineOutcome {
  return { kind: "FAILED", error: { code: "FAKE_FAILURE", message: `Fallo simulado en la etapa ${stage}.` } };
}

export function createFakePipeline(config: FakeConfig): JobPipeline {
  return {
    async run(context) {
      const stages = FAKE_STAGES.filter((stage) => !(stage === JOB_STAGE.SWAPPING && context.mode === JOB_MODE.TEST));
      for (const stage of stages) {
        if (context.signal.aborted) return { kind: "CANCELLED" };
        context.setStage(stage);
        context.log(LOG_LEVEL.INFO, `Simulando etapa ${stage}.`);
        if (config.failAtStage === stage) return failure(stage);
        const ms = stageDuration(config, stage);
        if (config.holdStage === stage) await runHeldStatement(context, ms, config.ignoreCancel === true);
        else await runTickedStage(context, stage, ms);
        context.updateProgress({ stageFraction: 1 });
      }
      if (context.signal.aborted) return { kind: "CANCELLED" };
      return context.mode === JOB_MODE.TEST
        ? { kind: "SUCCEEDED", gates: FAKE_GATES, testReport: FAKE_TEST_REPORT }
        : { kind: "SUCCEEDED", gates: FAKE_GATES };
    },
  };
}
