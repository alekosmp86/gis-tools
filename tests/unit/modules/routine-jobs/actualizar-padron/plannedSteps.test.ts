import { describe, expect, it } from "vitest";
import { plannedStepLabels, STEP } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/plannedSteps";

describe("plannedStepLabels DELETE step (AP-107)", () => {
  it("should list STEP.DELETE right after STEP.REASSIGN and before STEP.ANALYZE in a real run with no address master link", () => {
    const steps = plannedStepLabels({ dryRun: false });

    expect(steps).toContain(STEP.DELETE);
    const reassignIndex = steps.indexOf(STEP.REASSIGN);
    const deleteIndex = steps.indexOf(STEP.DELETE);
    const analyzeIndex = steps.indexOf(STEP.ANALYZE);
    expect(deleteIndex).toBe(reassignIndex + 1);
    expect(deleteIndex).toBeLessThan(analyzeIndex);
  });

  it("should list STEP.DELETE right after STEP.REASSIGN and before the address-master steps and STEP.ANALYZE when linkAddressMaster is on", () => {
    const steps = plannedStepLabels({ dryRun: false, linkAddressMaster: true });

    const reassignIndex = steps.indexOf(STEP.REASSIGN);
    const deleteIndex = steps.indexOf(STEP.DELETE);
    const addressSequencesIndex = steps.indexOf(STEP.ADDRESS_SEQUENCES);
    const analyzeIndex = steps.indexOf(STEP.ANALYZE);
    expect(deleteIndex).toBe(reassignIndex + 1);
    expect(deleteIndex).toBeLessThan(addressSequencesIndex);
    expect(deleteIndex).toBeLessThan(analyzeIndex);
  });

  it("should never list STEP.DELETE in an analysis, with or without the address master link: an analysis has no delete step", () => {
    expect(plannedStepLabels({ dryRun: true })).not.toContain(STEP.DELETE);
    expect(plannedStepLabels({ dryRun: true, linkAddressMaster: true })).not.toContain(STEP.DELETE);
  });
});

describe("plannedStepLabels REASSIGN step (AP-115)", () => {
  it("should name the step Reasignar direcciones de padrones subdivididos", () => {
    expect(STEP.REASSIGN).toBe("Reasignar direcciones de padrones subdivididos");
  });

  it.each([false, true])("should list STEP.REASSIGN right after STEP.APPLY (the pair apply step) and before STEP.DELETE in a real run, linkAddressMaster=%s", (linkAddressMaster) => {
    const steps = plannedStepLabels({ dryRun: false, linkAddressMaster });

    expect(steps.indexOf(STEP.REASSIGN)).toBe(steps.indexOf(STEP.APPLY) + 1);
    expect(steps.indexOf(STEP.DELETE)).toBe(steps.indexOf(STEP.REASSIGN) + 1);
  });

  it.each([false, true])("should never list STEP.REASSIGN in an analysis, linkAddressMaster=%s", (linkAddressMaster) => {
    expect(plannedStepLabels({ dryRun: true, linkAddressMaster })).not.toContain(STEP.REASSIGN);
  });
});
