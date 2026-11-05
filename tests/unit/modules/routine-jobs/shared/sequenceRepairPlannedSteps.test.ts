import { describe, expect, it } from "vitest";
import { STEP, plannedStepLabels } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/plannedSteps";
import { LOCALITY_STEP, plannedLocalityStepLabels } from "@/modules/routine-jobs/jobs/cargar-localidades/domain/plannedSteps";
import { UNIT_STEP, plannedUnitStepLabels } from "@/modules/routine-jobs/jobs/unidad-territorial/domain/plannedSteps";

describe("plannedStepLabels sequence steps (SQ-3)", () => {
  it.each([false, true])("should list the target sequence step in a real run when SQ-3 repairSequences is on, linkAddressMaster=%s", (linkAddressMaster) => {
    const steps = plannedStepLabels({ dryRun: false, linkAddressMaster, repairSequences: true });

    expect(steps).toContain(STEP.SEQUENCES);
    expect(steps.indexOf(STEP.SEQUENCES)).toBe(steps.indexOf(STEP.CLASSIFY) + 1);
    expect(steps.indexOf(STEP.SEQUENCES)).toBeLessThan(steps.indexOf(STEP.APPLY));
  });

  it("should list the address master sequence step before the address master classify step when SQ-3 repairSequences is on and the link is on", () => {
    const steps = plannedStepLabels({ dryRun: false, linkAddressMaster: true, repairSequences: true });

    expect(steps.indexOf(STEP.ADDRESS_SEQUENCES)).toBe(steps.indexOf(STEP.ADDRESS_CLASSIFY) - 1);
  });

  it.each([false, true])("should omit every sequence step in a real run when SQ-3 repairSequences is off, linkAddressMaster=%s", (linkAddressMaster) => {
    const steps = plannedStepLabels({ dryRun: false, linkAddressMaster, repairSequences: false });

    expect(steps).not.toContain(STEP.SEQUENCES);
    expect(steps).not.toContain(STEP.ADDRESS_SEQUENCES);
  });

  it("should keep the address master pass steps and the rest of the plan when SQ-3 repairSequences is off", () => {
    const off = plannedStepLabels({ dryRun: false, linkAddressMaster: true, repairSequences: false });
    const on = plannedStepLabels({ dryRun: false, linkAddressMaster: true, repairSequences: true });

    expect(on.filter((label) => label !== STEP.SEQUENCES && label !== STEP.ADDRESS_SEQUENCES)).toEqual(off);
  });

  it.each([false, true])("should never list a sequence step in an analysis whatever SQ-3 repairSequences is, repairSequences=%s", (repairSequences) => {
    const steps = plannedStepLabels({ dryRun: true, linkAddressMaster: true, repairSequences });

    expect(steps).not.toContain(STEP.SEQUENCES);
    expect(steps).not.toContain(STEP.ADDRESS_SEQUENCES);
  });
});

describe("plannedUnitStepLabels sequence steps (SQ-3)", () => {
  it.each([false, true])("should list the target sequence step between classify and apply when SQ-3 repairSequences is on, dryRun=%s", (dryRun) => {
    const steps = plannedUnitStepLabels({ dryRun, repairSequences: true });

    expect(steps.indexOf(UNIT_STEP.SEQUENCES)).toBe(steps.indexOf(UNIT_STEP.CLASSIFY) + 1);
    expect(steps.indexOf(UNIT_STEP.APPLY)).toBe(steps.indexOf(UNIT_STEP.SEQUENCES) + 1);
  });

  it("should list the address master sequence step right before the address master classify step when SQ-3 repairSequences and the link are on", () => {
    const steps = plannedUnitStepLabels({ dryRun: false, linkAddressMaster: true, repairSequences: true });

    expect(steps.indexOf(UNIT_STEP.ADDRESS_SEQUENCES)).toBe(steps.indexOf(UNIT_STEP.ADDRESS_CLASSIFY) - 1);
  });

  it.each([false, true])("should omit every sequence step when SQ-3 repairSequences is off, linkAddressMaster=%s", (linkAddressMaster) => {
    const steps = plannedUnitStepLabels({ dryRun: false, linkAddressMaster, repairSequences: false });

    expect(steps).not.toContain(UNIT_STEP.SEQUENCES);
    expect(steps).not.toContain(UNIT_STEP.ADDRESS_SEQUENCES);
    expect(steps).toContain(UNIT_STEP.APPLY);
  });

  it("should keep the address master pass steps when SQ-3 repairSequences is off and the link is on", () => {
    const steps = plannedUnitStepLabels({ dryRun: false, linkAddressMaster: true, repairSequences: false });

    expect(steps).toEqual(expect.arrayContaining([UNIT_STEP.ADDRESS_CLASSIFY, UNIT_STEP.ADDRESS_APPLY, UNIT_STEP.ADDRESS_VERIFY]));
  });
});

describe("plannedLocalityStepLabels sequence step (SQ-3)", () => {
  const TABLES = ["carto.a", "carto.b"];

  it("should list one sequence step after the classify steps and before the apply steps when SQ-3 repairSequences is on", () => {
    const steps = plannedLocalityStepLabels({ dryRun: false, tables: TABLES, repairSequences: true });

    expect(steps.filter((label) => label === LOCALITY_STEP.SEQUENCES)).toHaveLength(1);
    expect(steps.indexOf(LOCALITY_STEP.SEQUENCES)).toBe(steps.indexOf("Clasificar localidades: carto.b") + 1);
    expect(steps.indexOf("Aplicar cambios: carto.a")).toBe(steps.indexOf(LOCALITY_STEP.SEQUENCES) + 1);
  });

  it("should omit the sequence step when SQ-3 repairSequences is off", () => {
    const steps = plannedLocalityStepLabels({ dryRun: false, tables: TABLES, repairSequences: false });

    expect(steps).not.toContain(LOCALITY_STEP.SEQUENCES);
    expect(steps).toContain("Aplicar cambios: carto.a");
  });

  it("should drop only the sequence step when SQ-3 repairSequences is turned off", () => {
    const on = plannedLocalityStepLabels({ dryRun: true, tables: TABLES, repairSequences: true });
    const off = plannedLocalityStepLabels({ dryRun: true, tables: TABLES, repairSequences: false });

    expect(on.filter((label) => label !== LOCALITY_STEP.SEQUENCES)).toEqual(off);
  });
});
