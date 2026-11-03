import { describe, expect, it } from "vitest";
import { plannedStepLabels, STEP } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/plannedSteps";

describe("plannedStepLabels DELETE step (AP-107)", () => {
  it("should list STEP.DELETE right after STEP.APPLY and before STEP.ANALYZE in a real run with no address master link", () => {
    const steps = plannedStepLabels({ dryRun: false });

    expect(steps).toContain(STEP.DELETE);
    const applyIndex = steps.indexOf(STEP.APPLY);
    const deleteIndex = steps.indexOf(STEP.DELETE);
    const analyzeIndex = steps.indexOf(STEP.ANALYZE);
    expect(deleteIndex).toBe(applyIndex + 1);
    expect(deleteIndex).toBeLessThan(analyzeIndex);
  });

  it("should list STEP.DELETE right after STEP.APPLY and before the address-master steps and STEP.ANALYZE when linkAddressMaster is on", () => {
    const steps = plannedStepLabels({ dryRun: false, linkAddressMaster: true });

    const applyIndex = steps.indexOf(STEP.APPLY);
    const deleteIndex = steps.indexOf(STEP.DELETE);
    const addressSequencesIndex = steps.indexOf(STEP.ADDRESS_SEQUENCES);
    const analyzeIndex = steps.indexOf(STEP.ANALYZE);
    expect(deleteIndex).toBe(applyIndex + 1);
    expect(deleteIndex).toBeLessThan(addressSequencesIndex);
    expect(deleteIndex).toBeLessThan(analyzeIndex);
  });

  it("should never list STEP.DELETE in an analysis, with or without the address master link: an analysis has no delete step", () => {
    expect(plannedStepLabels({ dryRun: true })).not.toContain(STEP.DELETE);
    expect(plannedStepLabels({ dryRun: true, linkAddressMaster: true })).not.toContain(STEP.DELETE);
  });
});
