import { describe, expect, it } from "vitest";
import {
  FAILURE_CODE_VIEW,
  currentPhaseLabel,
  describeFailure,
  elapsedMs,
  formatDuration,
  gateRows,
  overallPercent,
  phaseDetail,
  stagePercent,
} from "@/modules/coverage-loads/shp/domain/shpJobView.ts";
import { createInitialStatus } from "@/modules/coverage-loads/shp/job/statusTransitions.ts";
import type { JobGates, JobStatus } from "@/modules/coverage-loads/shp/job/types.ts";

function statusWith(patch: (s: JobStatus) => void = () => undefined): JobStatus {
  const status = createInitialStatus({
    jobId: "j1",
    mode: "LOAD",
    table: "lte",
    prefix: "LTEUruguay",
    fechaact: "2026-01-31",
    fileName: "LTEUruguay_20260131.shp",
    sizeBytes: 1000,
    receivedBytes: 1000,
    now: Date.parse("2026-01-31T10:00:00Z"),
    state: "RUNNING",
  });
  patch(status);
  return status;
}

describe("shpJobView", () => {
  describe("describeFailure", () => {
    it.each(Object.values(FAILURE_CODE_VIEW))("should give %s its own specific title", (code) => {
      const view = describeFailure({ code, message: "m", stage: null });

      expect(view.title.length).toBeGreaterThan(0);
      expect(view.title).not.toBe("La carga falló.");
    });

    it("should fall back to the generic title for an unknown code", () => {
      expect(describeFailure({ code: "NOPE", message: "m", stage: null }).title).toBe("La carga falló.");
    });

    it("should fall back to the generic title with no detail for a null error", () => {
      expect(describeFailure(null)).toEqual({ title: "La carga falló.", detail: null });
    });

    it("should append the phase label when the error carries a stage", () => {
      const view = describeFailure({ code: "GATE_FAILED", message: "razones", stage: "REPAIRING" });

      expect(view.title).toContain("(fase: Reparando geometrías)");
      expect(view.detail).toBe("razones");
    });

    it("should report a null detail for an empty message", () => {
      expect(describeFailure({ code: "SHP_EMPTY", message: "", stage: null }).detail).toBeNull();
    });
  });

  describe("gateRows", () => {
    const gates = (patch: Partial<JobGates>): JobGates => ({ stagingRows: 10, maxVertices: 256, invalidPieces: 0, areaRelativeDiff: 0, passed: true, ...patch });

    it("should pass every row for a healthy verdict", () => {
      expect(gateRows(gates({})).every((row) => row.passed)).toBe(true);
    });

    it("should pass at exactly 1024 vertices and fail at 1025", () => {
      expect(gateRows(gates({ maxVertices: 1024 }))[1]?.passed).toBe(true);
      expect(gateRows(gates({ maxVertices: 1025 }))[1]?.passed).toBe(false);
    });

    it("should pass at exactly 1e-6 area difference and fail above it", () => {
      expect(gateRows(gates({ areaRelativeDiff: 1e-6 }))[3]?.passed).toBe(true);
      expect(gateRows(gates({ areaRelativeDiff: 1.0000001e-6 }))[3]?.passed).toBe(false);
    });

    it("should fail rows for zero staged rows and any invalid piece", () => {
      const rows = gateRows(gates({ stagingRows: 0, invalidPieces: 1 }));

      expect(rows[0]?.passed).toBe(false);
      expect(rows[2]?.passed).toBe(false);
    });
  });

  describe("phaseDetail", () => {
    it("should be null when the phase reports no count", () => {
      expect(phaseDetail(statusWith((s) => {
      s.stage = "READING";
      s.progress.bytesTotal = 0;
    }))).toBeNull();
      expect(phaseDetail(statusWith((s) => (s.stage = "SWAPPING")))).toBeNull();
      expect(phaseDetail(statusWith((s) => (s.stage = null)))).toBeNull();
    });

    it("should describe bytes read while reading or staging", () => {
      const status = statusWith((s) => {
        s.stage = "STAGING";
        s.progress.bytesTotal = 2048;
        s.progress.bytesRead = 1024;
      });

      expect(phaseDetail(status)).toMatch(/^Leído .* de /);
    });

    it("should describe pieces while subdividing and repairing", () => {
      const sub = statusWith((s) => {
        s.stage = "SUBDIVIDING";
        s.progress.piecesTotal = 5;
      });
      const rep = statusWith((s) => {
        s.stage = "REPAIRING";
        s.progress.piecesTotal = 10;
        s.progress.piecesRepaired = 4;
      });

      expect(phaseDetail(sub)).toContain("piezas generadas");
      expect(phaseDetail(rep)).toContain("piezas reparadas");
    });
  });

  describe("percentages and time", () => {
    it("should round stage and overall fractions to whole percents", () => {
      const status = statusWith((s) => {
        s.progress.stageFraction = 0.456;
        s.progress.overallFraction = 0.999;
      });

      expect(stagePercent(status)).toBe(46);
      expect(overallPercent(status)).toBe(100);
      expect(overallPercent(null)).toBe(0);
    });

    it("should format durations with and without hours", () => {
      expect(formatDuration(0)).toBe("00:00");
      expect(formatDuration(65_000)).toBe("01:05");
      expect(formatDuration(3_661_000)).toBe("1:01:01");
    });

    it("should measure elapsed time from startedAt to the last write and never go negative", () => {
      const status = statusWith((s) => {
        s.startedAt = "2026-01-31T10:00:00.000Z";
        s.updatedAt = "2026-01-31T10:01:30.000Z";
      });
      const skewed = statusWith((s) => {
        s.startedAt = "2026-01-31T10:05:00.000Z";
        s.updatedAt = "2026-01-31T10:00:00.000Z";
      });

      expect(elapsedMs(status)).toBe(90_000);
      expect(elapsedMs(skewed)).toBe(0);
      expect(elapsedMs(statusWith())).toBe(0);
      expect(elapsedMs(null)).toBe(0);
    });

    it("should label the phase from the stage, the state, or a starting message", () => {
      expect(currentPhaseLabel(null)).toBe("Iniciando la carga");
      expect(currentPhaseLabel(statusWith((s) => (s.stage = "SWAPPING")))).toBe("Reemplazando la tabla");
      expect(currentPhaseLabel(statusWith((s) => (s.stage = null)))).toBe("En curso");
    });
  });
});
