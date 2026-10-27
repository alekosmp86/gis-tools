import { describe, expect, it } from "vitest";
import {
  plannedStepLabels,
  STEP,
  type StepLabel,
} from "@/modules/routine-jobs/jobs/actualizar-padron/domain/plannedSteps";

const DELETE_MODE = "delete" as const;
const TRUNCATE_MODE = "truncate" as const;

const BASE_STEPS: StepLabel[] = [
  STEP.VALIDATE,
  STEP.COUNT,
  STEP.CLEAR,
  STEP.RESOLVE,
  STEP.LOAD,
  STEP.ANALYZE,
  STEP.REPORT,
];

describe("plannedStepLabels", () => {
  describe("dry run (AP-17, AP-22, AP-23)", () => {
    it("should plan the analysis steps and end with the revert step when clear mode is delete", () => {
      const labels = plannedStepLabels({ dryRun: true, clearMode: DELETE_MODE });

      expect(labels).toEqual([...BASE_STEPS, STEP.ROLLBACK]);
    });

    it("should add the privileges step right after the count when clear mode is truncate", () => {
      const labels = plannedStepLabels({ dryRun: true, clearMode: TRUNCATE_MODE });

      expect(labels).toEqual([
        STEP.VALIDATE,
        STEP.COUNT,
        STEP.PRIVILEGES,
        STEP.CLEAR,
        STEP.RESOLVE,
        STEP.LOAD,
        STEP.ANALYZE,
        STEP.REPORT,
        STEP.ROLLBACK,
      ]);
    });

    it("should not plan a COMMIT step", () => {
      const labels = plannedStepLabels({ dryRun: true, clearMode: TRUNCATE_MODE });

      expect(labels).not.toContain(STEP.COMMIT);
    });

    it("should plan ANALYZE even though nothing is kept", () => {
      const labels = plannedStepLabels({ dryRun: true, clearMode: DELETE_MODE });

      expect(labels).toContain(STEP.ANALYZE);
    });

    it("should label the final step as the revert of the dry run in Spanish", () => {
      const labels = plannedStepLabels({ dryRun: true, clearMode: DELETE_MODE });

      expect(labels[labels.length - 1]).toBe(STEP.ROLLBACK);
      expect(STEP.ROLLBACK).toMatch(/revertir/i);
    });
  });

  describe("real run (AP-17, AP-22, AP-23)", () => {
    it("should plan the same analysis steps and end with the commit step when clear mode is delete", () => {
      const labels = plannedStepLabels({ dryRun: false, clearMode: DELETE_MODE });

      expect(labels).toEqual([...BASE_STEPS, STEP.COMMIT]);
    });

    it("should add the privileges step right after the count when clear mode is truncate", () => {
      const labels = plannedStepLabels({ dryRun: false, clearMode: TRUNCATE_MODE });

      expect(labels).toEqual([
        STEP.VALIDATE,
        STEP.COUNT,
        STEP.PRIVILEGES,
        STEP.CLEAR,
        STEP.RESOLVE,
        STEP.LOAD,
        STEP.ANALYZE,
        STEP.REPORT,
        STEP.COMMIT,
      ]);
    });

    it("should not plan a ROLLBACK step", () => {
      const labels = plannedStepLabels({ dryRun: false, clearMode: DELETE_MODE });

      expect(labels).not.toContain(STEP.ROLLBACK);
    });

    it("should label the commit step as confirming the changes in Spanish", () => {
      expect(STEP.COMMIT).toMatch(/confirmar/i);
    });
  });

  describe("shape", () => {
    it("should never repeat a step label in any combination", () => {
      for (const dryRun of [true, false]) {
        for (const clearMode of [DELETE_MODE, TRUNCATE_MODE]) {
          const labels = plannedStepLabels({ dryRun, clearMode });

          expect(new Set(labels).size, `${dryRun}/${clearMode}`).toBe(labels.length);
        }
      }
    });

    it("should give every step constant a distinct non-empty label", () => {
      const labels = Object.values(STEP);

      expect(new Set(labels).size).toBe(labels.length);
      for (const label of labels) {
        expect(label.trim().length).toBeGreaterThan(0);
      }
    });

    it("should never plan the sequence steps of the Cargar padrones job", () => {
      const labels = [
        ...plannedStepLabels({ dryRun: false, clearMode: TRUNCATE_MODE }),
        ...plannedStepLabels({ dryRun: true, clearMode: DELETE_MODE }),
      ];

      expect(labels.map((label) => label.toLowerCase()).join("|")).not.toMatch(/secuencia/);
    });

    it("should plan the steps in an order where the clear precedes the load and the load precedes the analysis", () => {
      const labels = plannedStepLabels({ dryRun: false, clearMode: TRUNCATE_MODE });

      const position = (label: StepLabel): number => labels.indexOf(label);
      expect(position(STEP.CLEAR)).toBeLessThan(position(STEP.RESOLVE));
      expect(position(STEP.RESOLVE)).toBeLessThan(position(STEP.LOAD));
      expect(position(STEP.LOAD)).toBeLessThan(position(STEP.ANALYZE));
      expect(position(STEP.ANALYZE)).toBeLessThan(position(STEP.REPORT));
      expect(position(STEP.REPORT)).toBeLessThan(position(STEP.COMMIT));
    });
  });
});
