import { describe, expect, it } from "vitest";
import {
  initialWizardState,
  initialWizardStateFor,
  WizardStep,
  type WizardState,
} from "@/modules/routine-jobs/ui/cargarPadronesWizardState";
import { buildWizardSteps, excludedFor, initialStepFor } from "@/modules/routine-jobs/ui/wizardSteps";

const TITLES = ["Conexión", "Tablas", "Opciones", "Revisar", "Resultado"];

const stateOf = (overrides: Partial<WizardState> = {}): WizardState => ({ ...initialWizardState(), ...overrides });

describe("buildWizardSteps", () => {
  it("AC-32: should define the five steps with ids 1 to 5 and the Spanish titles in order", () => {
    const steps = buildWizardSteps(initialWizardState());

    expect(steps.map((step) => step.id)).toEqual([1, 2, 3, 4, 5]);
    expect(steps.map((step) => step.title)).toEqual(TITLES);
  });

  it("AC-32: should give every step a subtitle and an icon", () => {
    for (const step of buildWizardSteps(initialWizardState())) {
      expect(step.subtitle.trim().length, step.title).toBeGreaterThan(0);
      expect(step.icon, step.title).toBeTruthy();
    }
  });

  it("AC-32: should keep the same five steps whatever the current wizard step is", () => {
    for (const step of Object.values(WizardStep)) {
      const steps = buildWizardSteps(stateOf({ step }));

      expect(steps.map((def) => def.id), step).toEqual([1, 2, 3, 4, 5]);
      expect(steps.map((def) => def.title), step).toEqual(TITLES);
    }
  });

  it("AC-32: should not mutate the state it is given", () => {
    const state = initialWizardState();
    const before = JSON.stringify(state);

    buildWizardSteps(state);

    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("excludedFor", () => {
  it("AC-32: should exclude nothing when no table is chosen", () => {
    expect(excludedFor({ ...initialWizardState(), tables: { rural: "", urbano: "", target: "" } })).toEqual({ rural: [], urbano: [], target: [] });
  });

  it("AC-32: should exclude, for each role, the tables chosen for the other two roles", () => {
    const excluded = excludedFor(stateOf({ tables: { rural: "r", urbano: "u", target: "t" } }));

    expect([...excluded.rural].sort()).toEqual(["t", "u"]);
    expect([...excluded.urbano].sort()).toEqual(["r", "t"]);
    expect([...excluded.target].sort()).toEqual(["r", "u"]);
  });

  it("AC-32: should never exclude a role's own table from itself", () => {
    const excluded = excludedFor(stateOf({ tables: { rural: "r", urbano: "u", target: "t" } }));

    expect(excluded.rural).not.toContain("r");
    expect(excluded.urbano).not.toContain("u");
    expect(excluded.target).not.toContain("t");
  });

  it("AC-32: should leave out roles that have no table yet", () => {
    const excluded = excludedFor(stateOf({ tables: { rural: "r", urbano: "", target: "" } }));

    expect(excluded).toEqual({ rural: [], urbano: ["r"], target: ["r"] });
  });

  it("AC-32: should treat a whitespace-only table as not chosen", () => {
    const excluded = excludedFor(stateOf({ tables: { rural: "r", urbano: "   ", target: "" } }));

    expect(excluded.target).toEqual(["r"]);
  });

  it("AC-32: should list a table once for a role even when both other roles chose it", () => {
    const excluded = excludedFor(stateOf({ tables: { rural: "same", urbano: "same", target: "" } }));

    expect(excluded.target.filter((name) => name === "same")).toHaveLength(1);
  });

  it("AC-32: should not mutate the state it is given", () => {
    const state = stateOf({ tables: { rural: "r", urbano: "u", target: "t" } });
    const before = JSON.stringify(state);

    excludedFor(state);

    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("initialStepFor", () => {
  it("AC-32: should open on the connection step when there is no run", () => {
    expect(initialStepFor({ phase: "idle" })).toBe(WizardStep.CONNECTION);
  });

  it.each(["starting", "running", "done", "failed", "unknown"] as const)(
    "AC-32: should re-attach to the result step when the run is %s",
    (phase) => {
      expect(initialStepFor({ phase })).toBe(WizardStep.RESULT);
    },
  );

  it("AC-32: should look at the phase only, not at the job details", () => {
    expect(initialStepFor({ phase: "idle", jobId: "job-1", error: "x" })).toBe(WizardStep.CONNECTION);
    expect(initialStepFor({ phase: "failed" })).toBe(WizardStep.RESULT);
  });

  it.each(["idle", "starting", "running", "done", "failed", "unknown"] as const)(
    "AC-32: should equal the step the wizard state opens on for the phase %s",
    (phase) => {
      expect(initialWizardStateFor({ phase }).step).toBe(initialStepFor({ phase }));
    },
  );
});
