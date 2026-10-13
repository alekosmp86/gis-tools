import { describe, expect, it } from "vitest";
import { StageStatus } from "@/modules/coverage-loads/shared/domain/stageContract";
import { FlowPhase } from "@/modules/coverage-loads/indicators/domain/loadFlow";
import { reportStage } from "@/modules/coverage-loads/indicators/domain/stageReport";
import type { LoadedCut, LoadResult } from "@/modules/coverage-loads/indicators/client";

function cut(overrides: Partial<LoadedCut> = {}): LoadedCut {
  return {
    fileName: "IndicadoresLTE_20260901.csv",
    fechaact: "2026-09-01",
    replacedRows: 0,
    insertedRows: 10,
    storedRows: 10,
    rejectedRows: 0,
    incomplete: false,
    incompleteMessage: null,
    ...overrides,
  };
}

function result(overrides: Partial<LoadResult> = {}): LoadResult {
  return { cuts: [cut()], totalInserted: 10, totalReplaced: 0, hasIncompleteCut: false, rejectedRows: [], ...overrides };
}

describe("reportStage", () => {
  describe("status per phase", () => {
    it.each([FlowPhase.PLANNING, FlowPhase.LOADING])("should report BUSY without outcome while %s", (phase) => {
      // Arrange & Act
      const report = reportStage({ phase, result: null });

      // Assert
      expect(report).toEqual({ status: StageStatus.BUSY, outcome: null });
    });

    it.each([FlowPhase.FILES, FlowPhase.REVIEW])("should report PENDING without outcome in %s", (phase) => {
      // Arrange & Act
      const report = reportStage({ phase, result: null });

      // Assert
      expect(report).toEqual({ status: StageStatus.PENDING, outcome: null });
    });

    it.each([FlowPhase.FILES, FlowPhase.REVIEW])("should ignore a stale result while %s", (phase) => {
      // Arrange & Act
      const report = reportStage({ phase, result: result() });

      // Assert
      expect(report).toEqual({ status: StageStatus.PENDING, outcome: null });
    });
  });

  describe("DONE outcome", () => {
    it("should summarise one loaded cut in the singular", () => {
      // Arrange
      const loaded = result({ totalInserted: 10, totalReplaced: 3 });

      // Act
      const report = reportStage({ phase: FlowPhase.DONE, result: loaded });

      // Assert
      expect(report.status).toBe(StageStatus.DONE);
      expect(report.outcome).toEqual({
        headline: "Carga completada",
        lines: ["1 corte cargado", "10 filas insertadas, 3 filas reemplazadas"],
      });
    });

    it("should summarise several cuts in the plural", () => {
      // Arrange
      const loaded = result({ cuts: [cut(), cut({ fechaact: "2026-09-02" })], totalInserted: 20, totalReplaced: 0 });

      // Act
      const report = reportStage({ phase: FlowPhase.DONE, result: loaded });

      // Assert
      expect(report.outcome?.lines).toEqual(["2 cortes cargados", "20 filas insertadas, 0 filas reemplazadas"]);
    });

    it("should use the plural for zero cuts", () => {
      // Arrange
      const loaded = result({ cuts: [], totalInserted: 0, totalReplaced: 0 });

      // Act
      const report = reportStage({ phase: FlowPhase.DONE, result: loaded });

      // Assert
      expect(report.status).toBe(StageStatus.DONE);
      expect(report.outcome?.lines).toEqual(["0 cortes cargados", "0 filas insertadas, 0 filas reemplazadas"]);
    });

    it("should add the incomplete-cut line and every cut's incomplete message", () => {
      // Arrange
      const loaded = result({
        cuts: [
          cut({ incomplete: true, incompleteMessage: "Corte 2026-09-01 incompleto" }),
          cut({ fechaact: "2026-09-02" }),
          cut({ fechaact: "2026-09-03", incomplete: true, incompleteMessage: "Corte 2026-09-03 incompleto" }),
        ],
        hasIncompleteCut: true,
      });

      // Act
      const report = reportStage({ phase: FlowPhase.DONE, result: loaded });

      // Assert
      expect(report.outcome?.lines).toEqual([
        "3 cortes cargados",
        "10 filas insertadas, 0 filas reemplazadas",
        "Hay al menos un corte incompleto: perdió filas rechazadas.",
        "Corte 2026-09-01 incompleto",
        "Corte 2026-09-03 incompleto",
      ]);
    });

    it("should add no incomplete lines when no cut lost rows", () => {
      // Arrange & Act
      const report = reportStage({ phase: FlowPhase.DONE, result: result() });

      // Assert
      expect(report.outcome?.lines).toHaveLength(2);
    });

    it("should report DONE with a null outcome when the result is missing", () => {
      // Arrange & Act
      const report = reportStage({ phase: FlowPhase.DONE, result: null });

      // Assert
      expect(report).toEqual({ status: StageStatus.DONE, outcome: null });
    });
  });
});
