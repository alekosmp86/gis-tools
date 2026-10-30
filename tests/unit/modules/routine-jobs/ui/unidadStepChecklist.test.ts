import { describe, expect, it } from "vitest";
import { plannedUnitStepLabels, UNIT_STEP } from "@/modules/routine-jobs/jobs/unidad-territorial/domain/plannedSteps";
import { resolvePlannedLabels } from "@/modules/routine-jobs/ui/stepChecklist";

describe("resolvePlannedLabels for the unidad territorial plan", () => {
  it("should keep resolving the stage 3 plan to its own steps", () => {
    const labels = resolvePlannedLabels({
      plan: { dryRun: false, target: "carto.territorial_unit", targetSchema: "carto", targetTable: "territorial_unit", linkAddressMaster: false },
    });

    expect(labels).toEqual(plannedUnitStepLabels({ dryRun: false }));
  });

  it("should show the address master pass steps only for a plan with linkAddressMaster on", () => {
    const planWith = (linkAddressMaster: boolean) => ({
      plan: { dryRun: false, target: "carto.territorial_unit", targetSchema: "carto", targetTable: "territorial_unit", linkAddressMaster },
    });

    const linked = resolvePlannedLabels(planWith(true));
    const unlinked = resolvePlannedLabels(planWith(false));

    expect(linked).toEqual(plannedUnitStepLabels({ dryRun: false, linkAddressMaster: true }));
    expect(linked).toContain(UNIT_STEP.ADDRESS_APPLY);
    expect(unlinked).not.toContain(UNIT_STEP.ADDRESS_APPLY);
  });
});
