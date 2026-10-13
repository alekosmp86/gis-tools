import { describe, expect, it } from "vitest";
import { EXPECTED_MS_BY_TABLE } from "@/modules/coverage-loads/shp/job/constants.ts";
import {
  applyProgress,
  computeOverallFraction,
  createInitialStatus,
  CRASH_ERROR,
  emptyProgress,
  finalizeStatus,
  markCrashed,
  startStage,
} from "@/modules/coverage-loads/shp/job/statusTransitions.ts";
import { JOB_MODE, JOB_STAGE, JOB_STATE, STAGE_STATE } from "@/modules/coverage-loads/shp/job/types.ts";
import type { JobStageId, JobState, JobStatus } from "@/modules/coverage-loads/shp/job/types.ts";

const T0 = Date.parse("2026-02-01T10:00:00.000Z");

function makeStatus(state: JobState = JOB_STATE.READY, mode: JobStatus["mode"] = JOB_MODE.LOAD): JobStatus {
  return createInitialStatus({
    jobId: "11111111-1111-4111-8111-111111111111",
    mode,
    table: "nbiot",
    prefix: "NBIoTUruguay",
    fechaact: "2026-01-31",
    fileName: "NBIoTUruguay_20260131.shp",
    sizeBytes: 100,
    receivedBytes: 100,
    now: T0,
    state,
  });
}

function stateOf(status: JobStatus, id: JobStageId): string {
  return status.stages.find((stage) => stage.id === id)!.state;
}

describe("createInitialStatus", () => {
  it("should create 7 stages in pipeline order", () => {
    expect(makeStatus().stages.map((stage) => stage.id)).toEqual([
      "COPYING_FILE",
      "READING",
      "STAGING",
      "SUBDIVIDING",
      "REPAIRING",
      "SWAPPING",
      "FINALIZING",
    ]);
  });

  it("should start UPLOADING with COPYING_FILE running when no state is given", () => {
    const status = createInitialStatus({
      jobId: "a",
      mode: JOB_MODE.LOAD,
      table: "lte",
      prefix: "LTEUruguay",
      fechaact: "2026-01-31",
      fileName: "f",
      sizeBytes: 10,
      receivedBytes: 0,
      now: T0,
    });

    expect(status.state).toBe(JOB_STATE.UPLOADING);
    expect(status.stage).toBe(JOB_STAGE.COPYING_FILE);
    expect(status.stages[0].state).toBe(STAGE_STATE.RUNNING);
    expect(status.stages[0].startedAt).toBe("2026-02-01T10:00:00.000Z");
    expect(status.stages.slice(1).every((stage) => stage.state === STAGE_STATE.PENDING)).toBe(true);
  });

  it("should start READY with COPYING_FILE done and no current stage", () => {
    const status = makeStatus(JOB_STATE.READY);

    expect(status.state).toBe(JOB_STATE.READY);
    expect(status.stage).toBeNull();
    expect(status.stages[0]).toMatchObject({ state: STAGE_STATE.DONE, durationMs: 0 });
  });

  it("should seed defaults: expected ms per table, no pid, no error, empty progress", () => {
    const status = makeStatus();

    expect(status.schemaVersion).toBe(1);
    expect(status.expectedMs).toBe(EXPECTED_MS_BY_TABLE.nbiot);
    expect(status.pid).toBeNull();
    expect(status.heartbeatAt).toBeNull();
    expect(status.startedAt).toBeNull();
    expect(status.error).toBeNull();
    expect(status.cancelRequested).toBe(false);
    expect(status.leftovers).toEqual([]);
    expect(status.progress).toEqual(emptyProgress(100));
    expect(status.target).toEqual({ table: "nbiot", prefix: "NBIoTUruguay", fechaact: "2026-01-31" });
    expect(status.source).toEqual({ fileName: "NBIoTUruguay_20260131.shp", sizeBytes: 100, receivedBytes: 100 });
  });
});

describe("computeOverallFraction", () => {
  it("should return 0 when every stage is skipped", () => {
    const status = makeStatus();
    status.stages.forEach((stage) => (stage.state = STAGE_STATE.SKIPPED));
    expect(computeOverallFraction(status.stages, 0.5)).toBe(0);
  });

  it("should weight equally over non-skipped stages and cap at 1", () => {
    const status = makeStatus();
    status.stages[5].state = STAGE_STATE.SKIPPED;
    // COPYING_FILE done: 1 of 6 counted
    expect(computeOverallFraction(status.stages, 0)).toBeCloseTo(1 / 6);
    expect(computeOverallFraction(status.stages, 5)).toBe(1);
  });
});

describe("startStage", () => {
  it("should close the running stage as DONE with its duration and open the next", () => {
    const status = makeStatus();
    startStage(status, JOB_STAGE.READING, T0 + 1000);
    startStage(status, JOB_STAGE.STAGING, T0 + 4000);

    const reading = status.stages.find((stage) => stage.id === JOB_STAGE.READING)!;
    expect(reading).toMatchObject({ state: STAGE_STATE.DONE, durationMs: 3000 });
    expect(reading.endedAt).toBe(new Date(T0 + 4000).toISOString());
    expect(stateOf(status, JOB_STAGE.STAGING)).toBe(STAGE_STATE.RUNNING);
    expect(status.stage).toBe(JOB_STAGE.STAGING);
    expect(status.updatedAt).toBe(new Date(T0 + 4000).toISOString());
  });

  it("should reset the stage fraction and recompute the overall fraction", () => {
    const status = makeStatus();
    status.progress.stageFraction = 0.9;
    startStage(status, JOB_STAGE.READING, T0);

    expect(status.progress.stageFraction).toBe(0);
    expect(status.progress.overallFraction).toBeCloseTo(1 / 7);
  });

  it("should clamp a negative duration to 0 when the clock goes backwards", () => {
    const status = makeStatus();
    startStage(status, JOB_STAGE.READING, T0 + 5000);
    startStage(status, JOB_STAGE.STAGING, T0);

    expect(status.stages.find((stage) => stage.id === JOB_STAGE.READING)!.durationMs).toBe(0);
  });
});

describe("applyProgress", () => {
  it("should merge the partial and recompute the overall fraction", () => {
    const status = makeStatus();
    startStage(status, JOB_STAGE.READING, T0);
    applyProgress(status, { rowsCopied: 10, stageFraction: 0.5 });

    expect(status.progress.rowsCopied).toBe(10);
    expect(status.progress.bytesTotal).toBe(100);
    expect(status.progress.overallFraction).toBeCloseTo(1.5 / 7);
  });
});

describe("finalizeStatus", () => {
  function runningThrough(status: JobStatus, stage: JobStageId): void {
    status.state = JOB_STATE.RUNNING;
    for (const id of [JOB_STAGE.READING, JOB_STAGE.STAGING, JOB_STAGE.SUBDIVIDING, JOB_STAGE.REPAIRING, JOB_STAGE.SWAPPING, JOB_STAGE.FINALIZING]) {
      startStage(status, id, T0 + 1000);
      if (id === stage) return;
    }
  }

  it("should mark SUCCEEDED, close the last stage and fill gates, report and leftovers", () => {
    const status = makeStatus();
    runningThrough(status, JOB_STAGE.FINALIZING);
    const gates = { stagingRows: 1, maxVertices: 2, invalidPieces: 0, areaRelativeDiff: 0, passed: true };

    finalizeStatus(status, { kind: "SUCCEEDED", gates, leftovers: ["old_table"] }, T0 + 9000);

    expect(status.state).toBe(JOB_STATE.SUCCEEDED);
    expect(status.stage).toBeNull();
    expect(status.gates).toEqual(gates);
    expect(status.testReport).toBeNull();
    expect(status.leftovers).toEqual(["old_table"]);
    expect(status.progress).toMatchObject({ stageFraction: 1, overallFraction: 1 });
    expect(status.stages.every((stage) => stage.state === STAGE_STATE.DONE)).toBe(true);
    expect(status.updatedAt).toBe(new Date(T0 + 9000).toISOString());
  });

  it("should leave never-started PENDING stages SKIPPED on success (TEST skips SWAPPING)", () => {
    const status = makeStatus(JOB_STATE.READY, JOB_MODE.TEST);
    status.state = JOB_STATE.RUNNING;
    for (const id of [JOB_STAGE.READING, JOB_STAGE.STAGING, JOB_STAGE.SUBDIVIDING, JOB_STAGE.REPAIRING, JOB_STAGE.FINALIZING]) {
      startStage(status, id, T0 + 1000);
    }
    const testReport = { current: { rows: 1, vertices: 1, area: 1 }, new: { rows: 2, vertices: 2, area: 2 }, diff: { rows: 1, vertices: 1, area: 1 } };

    finalizeStatus(status, { kind: "SUCCEEDED", testReport }, T0 + 2000);

    expect(stateOf(status, JOB_STAGE.SWAPPING)).toBe(STAGE_STATE.SKIPPED);
    expect(stateOf(status, JOB_STAGE.FINALIZING)).toBe(STAGE_STATE.DONE);
    expect(status.testReport).toEqual(testReport);
    expect(status.gates).toBeNull();
  });

  it("should mark FAILED with code, message and the stage that was running", () => {
    const status = makeStatus();
    runningThrough(status, JOB_STAGE.STAGING);

    finalizeStatus(status, { kind: "FAILED", error: { code: "BOOM", message: "fallo" } }, T0 + 3000);

    expect(status.state).toBe(JOB_STATE.FAILED);
    expect(status.error).toEqual({ code: "BOOM", message: "fallo", stage: JOB_STAGE.STAGING });
    expect(stateOf(status, JOB_STAGE.STAGING)).toBe(STAGE_STATE.FAILED);
    expect(stateOf(status, JOB_STAGE.SUBDIVIDING)).toBe(STAGE_STATE.PENDING);
    expect(status.stage).toBeNull();
  });

  it("should record a null stage when failing with no running stage", () => {
    const status = makeStatus();
    status.state = JOB_STATE.RUNNING;

    finalizeStatus(status, { kind: "FAILED", error: { code: "X", message: "m" } }, T0);

    expect(status.error?.stage).toBeNull();
  });

  it("should mark CANCELLED, skip the running stage and flag cancelRequested", () => {
    const status = makeStatus();
    runningThrough(status, JOB_STAGE.REPAIRING);

    finalizeStatus(status, { kind: "CANCELLED" }, T0 + 4000);

    expect(status.state).toBe(JOB_STATE.CANCELLED);
    expect(status.cancelRequested).toBe(true);
    expect(stateOf(status, JOB_STAGE.REPAIRING)).toBe(STAGE_STATE.SKIPPED);
    expect(status.error).toBeNull();
    expect(status.stage).toBeNull();
  });
});

describe("markCrashed", () => {
  it("should fail the job with JOB_CRASHED naming the running stage", () => {
    const status = makeStatus();
    status.state = JOB_STATE.RUNNING;
    startStage(status, JOB_STAGE.SUBDIVIDING, T0);

    markCrashed(status, T0 + 1);

    expect(status.state).toBe(JOB_STATE.FAILED);
    expect(status.error).toEqual({ code: "JOB_CRASHED", message: CRASH_ERROR.message, stage: JOB_STAGE.SUBDIVIDING });
  });
});
