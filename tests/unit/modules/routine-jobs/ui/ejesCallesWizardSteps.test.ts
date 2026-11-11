import { describe, expect, it } from "vitest";
import { initialEjesWizardState, EjesStep } from "@/modules/routine-jobs/ui/ejesCallesWizardState";
import { buildEjesWizardSteps, ejesStepIdOf, ejesStepOfId } from "@/modules/routine-jobs/ui/ejesCallesWizardSteps";
import { getEjesRunStore } from "@/modules/routine-jobs/ui/ejesCallesRunStore";
import { RunPhase } from "@/modules/routine-jobs/ui/jobRunStore";

describe("ejes wizard steps (EJ-24)", () => {
  it("should define Conexión, Tablas, Revisar and Resultado in order", () => {
    const steps = buildEjesWizardSteps(initialEjesWizardState());

    expect(steps.map((step) => step.title)).toEqual(["Conexión", "Tablas", "Revisar", "Resultado"]);
    expect(steps.map((step) => step.id)).toEqual([1, 2, 3, 4]);
  });

  it("should map step ids both ways and fall back to connection for an unknown id", () => {
    expect(ejesStepIdOf(EjesStep.RESULT)).toBe(4);
    expect(ejesStepOfId(3)).toBe(EjesStep.REVIEW);
    expect(ejesStepOfId(0)).toBe(EjesStep.CONNECTION);
    expect(ejesStepOfId(99)).toBe(EjesStep.CONNECTION);
  });

  it("should not allow proceeding from the blocked first step", () => {
    expect(buildEjesWizardSteps(initialEjesWizardState()).every((step) => !step.canProceed)).toBe(true);
  });

  it("should allow proceeding only on the current step when it can continue", () => {
    const state = {
      ...initialEjesWizardState(),
      connection: { host: "h", port: "5432", db_name: "d", user: "u", password: "" },
    };

    expect(buildEjesWizardSteps(state).map((step) => step.canProceed)).toEqual([true, false, false, false]);
  });
});

describe("getEjesRunStore", () => {
  it("should return a shared store that starts idle", () => {
    const store = getEjesRunStore();

    expect(getEjesRunStore()).toBe(store);
    expect(store.getSnapshot().phase).toBe(RunPhase.IDLE);
  });
});
