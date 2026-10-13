import { describe, expect, it } from "vitest";
import { checkShpFile } from "@/modules/coverage-loads/shp/domain/shpFileCheck.ts";
import { ShpActionType, shpFlowReducer } from "@/modules/coverage-loads/shp/domain/shpFlowReducer.ts";
import { INITIAL_SHP_FLOW, ShpPhase, canPlan, canStart, canUpload, isBusy } from "@/modules/coverage-loads/shp/domain/shpFlowState.ts";
import type { ShpFlowState } from "@/modules/coverage-loads/shp/domain/shpFlowState.ts";
import { CheckLevel, buildPlanChecks } from "@/modules/coverage-loads/shp/domain/shpPlanChecks.ts";
import { pickResumableJob } from "@/modules/coverage-loads/shp/domain/shpResume.ts";
import { reportShpStage } from "@/modules/coverage-loads/shp/domain/shpStageReport.ts";
import { createInitialStatus } from "@/modules/coverage-loads/shp/job/statusTransitions.ts";
import type { JobMode, JobState, JobStatus } from "@/modules/coverage-loads/shp/job/types.ts";
import type { JobSummary, ShpPlan } from "@/modules/coverage-loads/shp/types.ts";

const GIB = 1024 ** 3;
const file = (name: string, size: number) => ({ name, size }) as File;
const GOOD = file("LTEUruguay_20260131.shp", 10);

function status(state: JobState, mode: JobMode = "LOAD"): JobStatus {
  return createInitialStatus({
    jobId: "j1",
    mode,
    table: "lte",
    prefix: "LTEUruguay",
    fechaact: "2026-01-31",
    fileName: "LTEUruguay_20260131.shp",
    sizeBytes: 10,
    receivedBytes: 10,
    now: 0,
    state,
  });
}

const plan = (patch: Partial<ShpPlan> = {}): ShpPlan => ({
  jobId: "j1",
  target: { table: "lte", prefix: "LTEUruguay", fechaact: "2026-01-31" },
  defaultMode: "TEST",
  availableModes: ["TEST", "LOAD"],
  currentRows: 1234,
  leftovers: [],
  privilegeShortfalls: [],
  blockers: [],
  expectedMs: 0,
  canStart: true,
  ...patch,
});

const reduce = (state: ShpFlowState, ...actions: Parameters<typeof shpFlowReducer>[1][]): ShpFlowState => actions.reduce(shpFlowReducer, state);
const inPhase = (phase: ShpPhase, patch: Partial<ShpFlowState> = {}): ShpFlowState => ({ ...INITIAL_SHP_FLOW, phase, ...patch });

describe("shpFileCheck", () => {
  it("should accept a well-named non-empty file and derive the target", () => {
    expect(checkShpFile(GOOD)).toEqual({ ok: true, target: { table: "lte", prefix: "LTEUruguay", fechaact: "2026-01-31" } });
  });

  it("should refuse a badly named file", () => {
    expect(checkShpFile(file("foo.shp", 10)).ok).toBe(false);
  });

  it("should refuse an empty file", () => {
    expect(checkShpFile(file("LTEUruguay_20260131.shp", 0))).toMatchObject({ ok: false, message: expect.stringContaining("vacío") });
  });

  it("should accept exactly the 4 GiB cap and refuse one byte more", () => {
    expect(checkShpFile(file("LTEUruguay_20260131.shp", 4 * GIB)).ok).toBe(true);
    expect(checkShpFile(file("LTEUruguay_20260131.shp", 4 * GIB + 1))).toMatchObject({ ok: false, message: expect.stringContaining("4 GiB") });
  });
});

describe("shpFlowReducer", () => {
  it("should keep a valid picked file and record the error for an invalid one", () => {
    const pick = inPhase(ShpPhase.PICK);

    expect(reduce(pick, { type: ShpActionType.PICK_FILE, file: GOOD }).file).toBe(GOOD);
    const bad = reduce(pick, { type: ShpActionType.PICK_FILE, file: file("x.shp", 1) });
    expect(bad.file).toBeNull();
    expect(bad.fileError).not.toBeNull();
    expect(canUpload(bad)).toBe(false);
  });

  it("should ignore actions that do not belong to the current phase", () => {
    const running = inPhase(ShpPhase.RUNNING);

    expect(reduce(running, { type: ShpActionType.PICK_FILE, file: GOOD })).toBe(running);
    expect(reduce(running, { type: ShpActionType.PLAN_START })).toBe(running);
  });

  it("should walk pick -> upload -> review -> plan -> start -> run -> done", () => {
    const job = { jobId: "j1", target: plan().target, fileName: GOOD.name, sizeBytes: 10 };
    let s = reduce(inPhase(ShpPhase.PICK), { type: ShpActionType.PICK_FILE, file: GOOD }, { type: ShpActionType.UPLOAD_START });
    expect(s.phase).toBe(ShpPhase.UPLOADING);
    s = reduce(s, { type: ShpActionType.UPLOAD_PROGRESS, percent: 50 }, { type: ShpActionType.UPLOAD_SUCCESS, job });
    expect(s.phase).toBe(ShpPhase.REVIEW);
    expect(canPlan(s)).toBe(true);
    s = reduce(s, { type: ShpActionType.PLAN_START }, { type: ShpActionType.PLAN_SUCCESS, plan: plan(), revision: 3 });
    expect(s).toMatchObject({ phase: ShpPhase.REVIEW, planRevision: 3, mode: "TEST", confirmed: false });
    s = reduce(s, { type: ShpActionType.START_BEGIN }, { type: ShpActionType.START_SUCCESS });
    expect(s.phase).toBe(ShpPhase.RUNNING);
    s = reduce(s, { type: ShpActionType.STATUS_UPDATE, status: status("SUCCEEDED"), stale: false });
    expect(s.phase).toBe(ShpPhase.DONE);
  });

  it("should stay RUNNING on a live status and flag stale", () => {
    const s = reduce(inPhase(ShpPhase.RUNNING), { type: ShpActionType.STATUS_UPDATE, status: status("RUNNING"), stale: true });

    expect(s).toMatchObject({ phase: ShpPhase.RUNNING, stale: true });
  });

  it("should reset the confirmation when the mode changes and require it for LOAD only", () => {
    const review = inPhase(ShpPhase.REVIEW, { plan: plan(), job: { jobId: "j1", target: plan().target, fileName: "f", sizeBytes: 1 } });
    const confirmed = reduce(review, { type: ShpActionType.SET_MODE, mode: "LOAD" }, { type: ShpActionType.SET_CONFIRMED, value: true });

    expect(canStart(confirmed)).toBe(true);
    expect(canStart(reduce(confirmed, { type: ShpActionType.SET_MODE, mode: "LOAD" }))).toBe(false);
    expect(canStart(reduce(review, { type: ShpActionType.SET_MODE, mode: "TEST" }))).toBe(true);
    expect(canStart({ ...review, plan: plan({ canStart: false }), mode: "TEST" })).toBe(false);
    expect(canStart({ ...review, plan: null, mode: "TEST" })).toBe(false);
  });

  it("should return to REVIEW with the message and cleared confirmation when start fails", () => {
    const s = reduce(inPhase(ShpPhase.STARTING, { confirmed: true, plan: plan() }), { type: ShpActionType.START_FAILURE, message: "409" });

    expect(s).toMatchObject({ phase: ShpPhase.REVIEW, confirmed: false, error: "409" });
    expect(s.plan).not.toBeNull();
  });

  it("should replace the plan when a start failure carries a fresh one", () => {
    const fresh = plan({ canStart: false });

    expect(reduce(inPhase(ShpPhase.STARTING, { plan: plan() }), { type: ShpActionType.START_FAILURE, message: "m", plan: fresh }).plan).toBe(fresh);
  });

  describe("resume", () => {
    const resume = (st: JobStatus | null) => reduce(INITIAL_SHP_FLOW, { type: ShpActionType.RESUMED, status: st });

    it("should go to PICK when there is nothing to resume or the upload never finished", () => {
      expect(resume(null).phase).toBe(ShpPhase.PICK);
      expect(resume(status("UPLOADING")).phase).toBe(ShpPhase.PICK);
    });

    it("should go to REVIEW for READY, RUNNING for live and DONE for terminal jobs", () => {
      expect(resume(status("READY")).phase).toBe(ShpPhase.REVIEW);
      expect(resume(status("RUNNING")).phase).toBe(ShpPhase.RUNNING);
      expect(resume(status("CANCELLING")).phase).toBe(ShpPhase.RUNNING);
      for (const t of ["SUCCEEDED", "FAILED", "CANCELLED"] as const) expect(resume(status(t)).phase).toBe(ShpPhase.DONE);
    });

    it("should land on PICK with the message when resuming fails", () => {
      expect(reduce(INITIAL_SHP_FLOW, { type: ShpActionType.RESUME_FAILED, message: "no" })).toMatchObject({ phase: ShpPhase.PICK, error: "no" });
    });

    it("should pick the newest resumable job from a newest-first list", () => {
      const job = (jobId: string, state: string) => ({ jobId, state }) as JobSummary;

      expect(pickResumableJob([job("a", "FAILED"), job("b", "RUNNING"), job("c", "READY")])?.jobId).toBe("b");
      expect(pickResumableJob([job("a", "SUCCEEDED")])).toBeNull();
      expect(pickResumableJob([])).toBeNull();
    });
  });

  it("should report busy phases", () => {
    expect([ShpPhase.UPLOADING, ShpPhase.PLANNING, ShpPhase.STARTING, ShpPhase.RUNNING].every((p) => isBusy({ phase: p }))).toBe(true);
    expect([ShpPhase.PICK, ShpPhase.REVIEW, ShpPhase.DONE, ShpPhase.RESUMING].some((p) => isBusy({ phase: p }))).toBe(false);
  });
});

describe("shpPlanChecks", () => {
  it("should be all OK for a clean plan and show the row count", () => {
    const checks = buildPlanChecks(plan());

    expect(checks.every((c) => c.level === CheckLevel.OK)).toBe(true);
    expect(checks.find((c) => c.key === "rows")?.detail).toContain("1.234");
  });

  it("should turn blockers and privilege shortfalls into ERROR entries and leftovers into a WARNING", () => {
    const checks = buildPlanChecks(plan({ blockers: ["b1"], privilegeShortfalls: ["p1"], leftovers: ["shp_stage_lte"], currentRows: null }));

    expect(checks.filter((c) => c.level === CheckLevel.ERROR).map((c) => c.detail)).toEqual(["b1", "p1"]);
    expect(checks.find((c) => c.key === "leftovers")?.level).toBe(CheckLevel.WARNING);
    expect(checks.find((c) => c.key === "rows")?.detail).toContain("no disponible");
  });

  it("should never estimate less than one minute", () => {
    expect(buildPlanChecks(plan({ expectedMs: 1 })).find((c) => c.key === "duration")?.detail).toContain("1 min");
  });
});

describe("reportShpStage", () => {
  it("should be BUSY while busy and PENDING with no outcome otherwise", () => {
    expect(reportShpStage({ phase: ShpPhase.RUNNING, status: null })).toEqual({ status: "BUSY", outcome: null });
    expect(reportShpStage({ phase: ShpPhase.PICK, status: null })).toEqual({ status: "PENDING", outcome: null });
    expect(reportShpStage({ phase: ShpPhase.DONE, status: null })).toEqual({ status: "PENDING", outcome: null });
  });

  it("should report DONE with the table for success and say a TEST left the table untouched", () => {
    const load = reportShpStage({ phase: ShpPhase.DONE, status: status("SUCCEEDED") });
    const test = reportShpStage({ phase: ShpPhase.DONE, status: status("SUCCEEDED", "TEST") });

    expect(load).toMatchObject({ status: "DONE", outcome: { headline: "Carga completada" } });
    expect(load.outcome?.lines[0]).toContain("public.lte");
    expect(test.outcome?.headline).toContain("no fue modificada");
  });

  it("should report FAILED with the error message, or a fallback when it is missing", () => {
    const failed = status("FAILED");
    failed.error = { code: "X", message: "se rompió", stage: null };

    expect(reportShpStage({ phase: ShpPhase.DONE, status: failed })).toMatchObject({ status: "FAILED", outcome: { lines: ["se rompió"] } });
    expect(reportShpStage({ phase: ShpPhase.DONE, status: status("FAILED") }).outcome?.lines).toEqual(["Error desconocido."]);
  });

  it("should report a cancelled job as PENDING with an unchanged-table outcome", () => {
    expect(reportShpStage({ phase: ShpPhase.DONE, status: status("CANCELLED") })).toMatchObject({ status: "PENDING", outcome: { headline: "Carga cancelada" } });
  });
});
