import { describe, expect, it } from "vitest";
import { STEP, type StepLabel } from "@/modules/routine-jobs/jobs/cargar-padrones/domain/plannedSteps";
import { CargarPadronesRunPhase } from "@/modules/routine-jobs/ui/cargarPadronesRunStore";
import { buildStepChecklist, ChecklistStatus } from "@/modules/routine-jobs/ui/stepChecklist";

const PLANNED: StepLabel[] = [STEP.VALIDATE, STEP.COUNT, STEP.CLEAR, STEP.LOAD_RURAL];

describe("buildStepChecklist", () => {
  describe("running", () => {
    it("should mark steps before the current one as done and the current one as current", () => {
      const rows = buildStepChecklist({ plannedLabels: PLANNED, currentLabel: STEP.LOAD_RURAL, phase: CargarPadronesRunPhase.RUNNING });

      expect(rows.map((row) => row.status)).toEqual([
        ChecklistStatus.DONE,
        ChecklistStatus.DONE,
        ChecklistStatus.DONE,
        ChecklistStatus.CURRENT,
      ]);
    });

    it("should mark steps after the current one as pending", () => {
      const rows = buildStepChecklist({ plannedLabels: PLANNED, currentLabel: STEP.COUNT, phase: CargarPadronesRunPhase.RUNNING });

      expect(rows.map((row) => row.status)).toEqual([
        ChecklistStatus.DONE,
        ChecklistStatus.CURRENT,
        ChecklistStatus.PENDING,
        ChecklistStatus.PENDING,
      ]);
    });

    it("should mark every step pending when no current label is known", () => {
      const rows = buildStepChecklist({ plannedLabels: PLANNED, currentLabel: null, phase: CargarPadronesRunPhase.STARTING });

      expect(rows.map((row) => row.status)).toEqual(PLANNED.map(() => ChecklistStatus.PENDING));
    });

    it("should map each planned label to its Spanish UI label in order", () => {
      const rows = buildStepChecklist({ plannedLabels: PLANNED, currentLabel: null, phase: CargarPadronesRunPhase.STARTING });

      expect(rows.map((row) => row.label)).toEqual([
        "Validar tablas",
        "Contar filas de origen",
        "Vaciar la tabla destino",
        "Cargar padrones rurales",
      ]);
    });
  });

  describe("done", () => {
    it("should mark every planned step done regardless of the current label", () => {
      const rows = buildStepChecklist({ plannedLabels: PLANNED, currentLabel: STEP.COUNT, phase: CargarPadronesRunPhase.DONE });

      expect(rows.map((row) => row.status)).toEqual(PLANNED.map(() => ChecklistStatus.DONE));
    });
  });

  describe("failed and unknown", () => {
    it("should mark the current step failed and leave later steps pending", () => {
      const rows = buildStepChecklist({ plannedLabels: PLANNED, currentLabel: STEP.CLEAR, phase: CargarPadronesRunPhase.FAILED });

      expect(rows.map((row) => row.status)).toEqual([
        ChecklistStatus.DONE,
        ChecklistStatus.DONE,
        ChecklistStatus.FAILED,
        ChecklistStatus.PENDING,
      ]);
    });

    it("should mark the current step unknown and leave later steps pending", () => {
      const rows = buildStepChecklist({ plannedLabels: PLANNED, currentLabel: STEP.CLEAR, phase: CargarPadronesRunPhase.UNKNOWN });

      expect(rows.map((row) => row.status)).toEqual([
        ChecklistStatus.DONE,
        ChecklistStatus.DONE,
        ChecklistStatus.UNKNOWN,
        ChecklistStatus.PENDING,
      ]);
    });
  });

  describe("unexpected label", () => {
    it("should append an unplanned current label as a raw current row after the planned steps", () => {
      const rows = buildStepChecklist({ plannedLabels: PLANNED, currentLabel: "Paso inesperado", phase: CargarPadronesRunPhase.RUNNING });

      expect(rows.slice(-1)).toEqual([{ label: "Paso inesperado", status: ChecklistStatus.CURRENT }]);
      expect(rows.slice(0, -1).map((row) => row.status)).toEqual(PLANNED.map(() => ChecklistStatus.PENDING));
    });

    it("should append an unplanned label as failed when the run failed on it", () => {
      const rows = buildStepChecklist({ plannedLabels: PLANNED, currentLabel: "Paso inesperado", phase: CargarPadronesRunPhase.FAILED });

      expect(rows.at(-1)).toEqual({ label: "Paso inesperado", status: ChecklistStatus.FAILED });
    });
  });

  describe("empty input", () => {
    it("should return no rows when the plan is empty and no label is known", () => {
      expect(buildStepChecklist({ plannedLabels: [], currentLabel: null, phase: CargarPadronesRunPhase.IDLE })).toEqual([]);
    });
  });
});
