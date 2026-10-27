import { describe, expect, it } from "vitest";
import { plannedStepLabels, STEP, type StepLabel } from "@/modules/routine-jobs/jobs/cargar-padrones/domain/plannedSteps";

const BASE_LABELS: StepLabel[] = [STEP.VALIDATE, STEP.COUNT, STEP.CLEAR, STEP.LOAD_RURAL, STEP.LOAD_URBANO, STEP.REPORT];
const REAL_TAIL: StepLabel[] = [STEP.COMMIT, STEP.ANALYZE];

describe("plannedStepLabels", () => {
  describe("dry run", () => {
    it("should plan only the analysis steps when clear mode is delete and sequences are not reset", () => {
      const labels = plannedStepLabels({ dryRun: true, options: { clearMode: "delete", resetSequences: false } });

      expect(labels).toEqual(BASE_LABELS);
    });

    it("should add the privileges step when clear mode is truncate", () => {
      const labels = plannedStepLabels({ dryRun: true, options: { clearMode: "truncate", resetSequences: false } });

      expect(labels).toEqual([STEP.VALIDATE, STEP.COUNT, STEP.PRIVILEGES, STEP.CLEAR, STEP.LOAD_RURAL, STEP.LOAD_URBANO, STEP.REPORT]);
    });

    it("should omit the sequence steps even when sequences are requested to reset", () => {
      const labels = plannedStepLabels({ dryRun: true, options: { clearMode: "delete", resetSequences: true } });

      expect(labels).not.toContain(STEP.SEQUENCES_RESET);
      expect(labels).not.toContain(STEP.SEQUENCES_REPAIR);
      expect(labels).toEqual(BASE_LABELS);
    });

    it("should omit COMMIT and ANALYZE", () => {
      const labels = plannedStepLabels({ dryRun: true, options: { clearMode: "truncate", resetSequences: true } });

      expect(labels).not.toContain(STEP.COMMIT);
      expect(labels).not.toContain(STEP.ANALYZE);
    });
  });

  describe("real load", () => {
    it("should end with COMMIT and ANALYZE and skip sequences when delete without reset", () => {
      const labels = plannedStepLabels({ dryRun: false, options: { clearMode: "delete", resetSequences: false } });

      expect(labels).toEqual([...BASE_LABELS, ...REAL_TAIL]);
    });

    it("should add privileges, sequence reset and sequence repair around the load when truncate with reset", () => {
      const labels = plannedStepLabels({ dryRun: false, options: { clearMode: "truncate", resetSequences: true } });

      expect(labels).toEqual([
        STEP.VALIDATE,
        STEP.COUNT,
        STEP.PRIVILEGES,
        STEP.CLEAR,
        STEP.SEQUENCES_RESET,
        STEP.LOAD_RURAL,
        STEP.LOAD_URBANO,
        STEP.REPORT,
        STEP.SEQUENCES_REPAIR,
        ...REAL_TAIL,
      ]);
    });

    it("should bracket the load with sequence steps when delete with reset", () => {
      const labels = plannedStepLabels({ dryRun: false, options: { clearMode: "delete", resetSequences: true } });

      expect(labels.indexOf(STEP.SEQUENCES_RESET)).toBe(labels.indexOf(STEP.CLEAR) + 1);
      expect(labels.indexOf(STEP.SEQUENCES_REPAIR)).toBe(labels.indexOf(STEP.REPORT) + 1);
      expect(labels.slice(-2)).toEqual(REAL_TAIL);
    });

    it("should not add the privileges step when delete regardless of sequences", () => {
      const labels = plannedStepLabels({ dryRun: false, options: { clearMode: "delete", resetSequences: true } });

      expect(labels).not.toContain(STEP.PRIVILEGES);
    });

    it("should not add sequence steps when truncate without reset", () => {
      const labels = plannedStepLabels({ dryRun: false, options: { clearMode: "truncate", resetSequences: false } });

      expect(labels).toEqual([STEP.VALIDATE, STEP.COUNT, STEP.PRIVILEGES, STEP.CLEAR, STEP.LOAD_RURAL, STEP.LOAD_URBANO, STEP.REPORT, ...REAL_TAIL]);
    });
  });

  it("should never repeat a step label in any combination", () => {
    for (const dryRun of [true, false]) {
      for (const clearMode of ["delete", "truncate"] as const) {
        for (const resetSequences of [true, false]) {
          const labels = plannedStepLabels({ dryRun, options: { clearMode, resetSequences } });

          expect(new Set(labels).size, `${dryRun}/${clearMode}/${resetSequences}`).toBe(labels.length);
        }
      }
    }
  });
});
