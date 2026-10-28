import { describe, expect, it } from "vitest";
import { plannedCompletarStepLabels, COMPLETAR_STEP } from "@/modules/routine-jobs/jobs/completar-unidad-territorial/domain/plannedSteps";
import { plannedUnitStepLabels } from "@/modules/routine-jobs/jobs/unidad-territorial/domain/plannedSteps";
import { buildStepChecklist, ChecklistStatus, resolvePlannedLabels } from "@/modules/routine-jobs/ui/stepChecklist";
import { RunPhase } from "@/modules/routine-jobs/ui/jobRunStore";
import type { CompletarRunPlan } from "@/modules/routine-jobs/ui/completarUnidadTerritorialRunStore";

const DRY_PLAN: CompletarRunPlan = { dryRun: true, unitTable: "carto.territorial_unit", addressMasterTable: "carto.addresses_master" };
const REAL_PLAN: CompletarRunPlan = { ...DRY_PLAN, dryRun: false };

describe("resolvePlannedLabels for the completar plan", () => {
  it("should resolve a dry run to the completar steps ending with the rollback", () => {
    const labels = resolvePlannedLabels({ plan: DRY_PLAN });

    expect(labels).toEqual(plannedCompletarStepLabels({ dryRun: true }));
    expect(labels.at(-1)).toBe(COMPLETAR_STEP.ROLLBACK);
  });

  it("should resolve a real run to the completar steps ending with the commit and no rollback", () => {
    const labels = resolvePlannedLabels({ plan: REAL_PLAN });

    expect(labels).toEqual(plannedCompletarStepLabels({ dryRun: false }));
    expect(labels.at(-1)).toBe(COMPLETAR_STEP.COMMIT);
    expect(labels).not.toContain(COMPLETAR_STEP.ROLLBACK);
  });

  it("should prefer the steps the server sent over the planned labels", () => {
    expect(resolvePlannedLabels({ steps: ["Paso del servidor"], plan: DRY_PLAN })).toEqual(["Paso del servidor"]);
  });

  it("should fall back to the planned labels when the server sent an empty step list", () => {
    expect(resolvePlannedLabels({ steps: [], plan: REAL_PLAN })).toEqual(plannedCompletarStepLabels({ dryRun: false }));
  });

  it("should return no labels when neither the server steps nor a plan are known", () => {
    expect(resolvePlannedLabels({})).toEqual([]);
  });

  it("should keep resolving the stage 3 plan to its own steps", () => {
    const labels = resolvePlannedLabels({
      plan: { dryRun: false, target: "carto.territorial_unit", targetSchema: "carto", targetTable: "territorial_unit" },
    });

    expect(labels).toEqual(plannedUnitStepLabels({ dryRun: false }));
  });
});

describe("buildStepChecklist for the completar steps", () => {
  const LABELS = plannedCompletarStepLabels({ dryRun: false });
  const CURRENT_INDEX = LABELS.indexOf(COMPLETAR_STEP.APPLY);
  const statusesOf = (rows: { status: ChecklistStatus }[]) => rows.map((row) => row.status);

  it("should show the completar step labels as they are, in order", () => {
    const rows = buildStepChecklist({ plannedLabels: LABELS, currentLabel: null, phase: RunPhase.STARTING });

    expect(rows.map((row) => row.label)).toEqual(LABELS);
  });

  it("should mark the steps before the apply done, the apply current and the rest pending while running", () => {
    const rows = buildStepChecklist({ plannedLabels: LABELS, currentLabel: COMPLETAR_STEP.APPLY, phase: RunPhase.RUNNING });

    expect(statusesOf(rows)).toEqual(
      LABELS.map((_label, index) => (index < CURRENT_INDEX ? ChecklistStatus.DONE : index === CURRENT_INDEX ? ChecklistStatus.CURRENT : ChecklistStatus.PENDING)),
    );
  });

  it("should mark the apply failed and leave the later steps pending when the run failed on it", () => {
    const rows = buildStepChecklist({ plannedLabels: LABELS, currentLabel: COMPLETAR_STEP.APPLY, phase: RunPhase.FAILED });

    expect(rows[CURRENT_INDEX].status).toBe(ChecklistStatus.FAILED);
    expect(rows.slice(CURRENT_INDEX + 1).every((row) => row.status === ChecklistStatus.PENDING)).toBe(true);
  });

  it("should mark the apply unknown when the outcome of the run is unknown", () => {
    const rows = buildStepChecklist({ plannedLabels: LABELS, currentLabel: COMPLETAR_STEP.COMMIT, phase: RunPhase.UNKNOWN });

    expect(rows.find((row) => row.label === COMPLETAR_STEP.COMMIT)?.status).toBe(ChecklistStatus.UNKNOWN);
  });

  it("should mark every step done once the run is done", () => {
    const rows = buildStepChecklist({ plannedLabels: LABELS, currentLabel: null, phase: RunPhase.DONE });

    expect(statusesOf(rows).every((status) => status === ChecklistStatus.DONE)).toBe(true);
  });
});
