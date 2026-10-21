import { describe, expect, it } from "vitest";
import { AvanceFileKind, ReportKind } from "@/modules/coverage-loads/avance-ftth/constants";
import { FlowPhase } from "@/modules/coverage-loads/avance-ftth/domain/loadFlow";
import { reportStage } from "@/modules/coverage-loads/avance-ftth/domain/stageReport";
import type { AvanceLoadResult, LoadedFile } from "@/modules/coverage-loads/avance-ftth/types";
import { StageStatus } from "@/modules/coverage-loads/shared/domain/stageContract";

function loadedFile(kind: LoadedFile["kind"], overrides: Partial<LoadedFile> = {}): LoadedFile {
  return {
    kind,
    fileName: kind === AvanceFileKind.INT ? "SituacionFTTH_INT_21092026.csv" : "SituacionFTTH_UDPEM_21092026.csv",
    rowsLoaded: 100,
    junkDeleted: 10,
    avanceInserted: 40,
    unmatchedKeys: 0,
    ...overrides,
  };
}

function result(overrides: Partial<AvanceLoadResult> = {}): AvanceLoadResult {
  return {
    dryRun: false,
    files: [loadedFile(AvanceFileKind.INT), loadedFile(AvanceFileKind.UDPEM, { rowsLoaded: 60, junkDeleted: 5 })],
    history: { copied: 25, skipped: false, reason: null },
    avanceInserted: 80,
    byStatus: [],
    reports: [],
    elapsedMs: 10,
    warnings: [],
    rejectedRows: [],
    rejectedTotal: 0,
    ...overrides,
  };
}

describe("avance-ftth reportStage (AC-28)", () => {
  describe("status per phase", () => {
    it.each([FlowPhase.PLANNING, FlowPhase.RUNNING])("should report BUSY without outcome while %s", (phase) => {
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

    it("should stay PENDING after a dry run: nothing was persisted", () => {
      // Arrange & Act
      const report = reportStage({ phase: FlowPhase.DONE, result: result({ dryRun: true }) });

      // Assert
      expect(report).toEqual({ status: StageStatus.PENDING, outcome: null });
    });

    it("should stay PENDING when done without a result", () => {
      // Arrange & Act
      const report = reportStage({ phase: FlowPhase.DONE, result: null });

      // Assert
      expect(report).toEqual({ status: StageStatus.PENDING, outcome: null });
    });
  });

  describe("DONE outcome of a real load", () => {
    it("should publish DONE with the per-file counts, the Avance inserts and the history copy", () => {
      // Arrange & Act
      const report = reportStage({ phase: FlowPhase.DONE, result: result() });

      // Assert
      expect(report.status).toBe(StageStatus.DONE);
      expect(report.outcome).toEqual({
        headline: "Avance FTTH reconstruido",
        lines: [
          "SituacionFTTH_INT_21092026.csv: 100 filas cargadas, 10 de basura eliminadas",
          "SituacionFTTH_UDPEM_21092026.csv: 60 filas cargadas, 5 de basura eliminadas",
          "80 filas insertadas en el Avance",
          "25 filas copiadas al historial",
        ],
      });
    });

    it("should say why the history copy was skipped", () => {
      // Arrange
      const skipped = result({
        history: { copied: 0, skipped: true, reason: "historial omitido: el Avance actual ya fue cargado hoy" },
      });

      // Act
      const report = reportStage({ phase: FlowPhase.DONE, result: skipped });

      // Assert
      expect(report.outcome?.lines.at(-1)).toBe("historial omitido: el Avance actual ya fue cargado hoy");
    });

    it("should fall back to a generic text when the history copy was skipped without a reason", () => {
      // Arrange
      const skipped = result({ history: { copied: 0, skipped: true, reason: null } });

      // Act
      const report = reportStage({ phase: FlowPhase.DONE, result: skipped });

      // Assert
      expect(report.outcome?.lines.at(-1)).toBe("historial omitido");
    });

    it("should add a line counting the reports that failed, and none when every report ran", () => {
      // Arrange
      const failing = result({
        reports: [
          { kind: ReportKind.DUPLICADO, rows: 0, error: null },
          { kind: ReportKind.FUERA_CENTRAL, rows: null, error: "timeout" },
          { kind: ReportKind.ERROR_ESTADOS, rows: null, error: "timeout" },
        ],
      });
      const healthy = result({ reports: [{ kind: ReportKind.DUPLICADO, rows: 3, error: null }] });

      // Act
      const withFailures = reportStage({ phase: FlowPhase.DONE, result: failing });
      const withoutFailures = reportStage({ phase: FlowPhase.DONE, result: healthy });

      // Assert
      expect(withFailures.outcome?.lines.at(-1)).toBe("2 reportes fallaron al generarse");
      expect(withoutFailures.outcome?.lines).toHaveLength(4);
    });

    it("should list no file lines for a result without files", () => {
      // Arrange
      const empty = result({ files: [], avanceInserted: 0 });

      // Act
      const report = reportStage({ phase: FlowPhase.DONE, result: empty });

      // Assert
      expect(report.outcome?.lines).toEqual(["0 filas insertadas en el Avance", "25 filas copiadas al historial"]);
    });
  });
});
