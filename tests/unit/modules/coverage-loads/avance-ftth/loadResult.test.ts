import { describe, expect, it } from "vitest";
import { AvanceFileKind, ReportKind } from "@/modules/coverage-loads/avance-ftth/constants";
import {
  assertConsistentCounts,
  buildLoadResult,
  mergeStatusCounts,
} from "@/modules/coverage-loads/avance-ftth/domain/loadResult";
import type { LoadedFile } from "@/modules/coverage-loads/avance-ftth/types";
import { makeParsedFile, makeRow } from "./avanceHarness";

function loadedFile(kind: LoadedFile["kind"], overrides: Partial<LoadedFile> = {}): LoadedFile {
  return {
    kind,
    fileName: kind === AvanceFileKind.INT ? "SituacionFTTH_INT_21092026.csv" : "SituacionFTTH_UDPEM_21092026.csv",
    rowsLoaded: 10,
    junkDeleted: 2,
    avanceInserted: 3,
    unmatchedKeys: 0,
    ...overrides,
  };
}

describe("avance-ftth load result (AC-18, AC-20)", () => {
  describe("assertConsistentCounts", () => {
    const files = [
      loadedFile(AvanceFileKind.INT, { rowsLoaded: 10, junkDeleted: 2, avanceInserted: 3 }),
      loadedFile(AvanceFileKind.UDPEM, { rowsLoaded: 6, junkDeleted: 1, avanceInserted: 4 }),
    ];

    it("should accept staging counts equal to loaded minus junk and an Avance count equal to the sum of the inserts", () => {
      // Arrange
      const input = { files, stagingCounts: { INT: 8, UDPEM: 5 }, avanceCount: 7 };

      // Act & Assert
      expect(() => assertConsistentCounts(input)).not.toThrow();
    });

    it("should not compare the Avance with the staging counts: duplicates collapse", () => {
      // Arrange: staging 8 + 5 = 13 rows but only 7 reached the Avance
      const input = { files, stagingCounts: { INT: 8, UDPEM: 5 }, avanceCount: 7 };

      // Act & Assert
      expect(() => assertConsistentCounts(input)).not.toThrow();
      expect(() => assertConsistentCounts({ ...input, avanceCount: 13 })).toThrow(/El Avance quedó con 13 filas y los inserts escribieron 7/);
    });

    it.each([
      ["one row more", 9],
      ["one row fewer", 7],
    ])("should throw naming both numbers when the Interior staging holds %s than expected", (_label, found) => {
      // Arrange
      const input = { files, stagingCounts: { INT: found, UDPEM: 5 }, avanceCount: 7 };

      // Act & Assert
      expect(() => assertConsistentCounts(input)).toThrow(
        `La planilla de Interior quedó con ${found} filas y se esperaban 8; se deshizo la carga.`
      );
    });

    it("should throw for the UDPEM staging mismatch with the UDPEM label", () => {
      // Arrange
      const input = { files, stagingCounts: { INT: 8, UDPEM: 6 }, avanceCount: 7 };

      // Act & Assert
      expect(() => assertConsistentCounts(input)).toThrow(
        "La planilla de Montevideo (UDPEM) quedó con 6 filas y se esperaban 5; se deshizo la carga."
      );
    });

    it("should throw when the Avance holds one row fewer than the inserts wrote", () => {
      // Arrange
      const input = { files, stagingCounts: { INT: 8, UDPEM: 5 }, avanceCount: 6 };

      // Act & Assert
      expect(() => assertConsistentCounts(input)).toThrow("El Avance quedó con 6 filas y los inserts escribieron 7; se deshizo la carga.");
    });

    it("should expect an empty Avance when nothing was inserted", () => {
      // Arrange
      const none = [loadedFile(AvanceFileKind.INT, { avanceInserted: 0 }), loadedFile(AvanceFileKind.UDPEM, { avanceInserted: 0 })];
      const input = { files: none, stagingCounts: { INT: 8, UDPEM: 8 }, avanceCount: 0 };

      // Act & Assert
      expect(() => assertConsistentCounts(input)).not.toThrow();
    });
  });

  describe("mergeStatusCounts", () => {
    it("should add the counts of equal statuses and sort by status", () => {
      // Arrange
      const groups = [
        [
          { status: "Proyectado/Instalacion", count: 2 },
          { status: "Existente", count: 5 },
        ],
        [
          { status: "Existente", count: 3 },
          { status: "Proyectado/Eliminacion", count: 1 },
        ],
      ];

      // Act
      const merged = mergeStatusCounts(groups);

      // Assert
      expect(merged).toEqual([
        { status: "Existente", count: 8 },
        { status: "Proyectado/Eliminacion", count: 1 },
        { status: "Proyectado/Instalacion", count: 2 },
      ]);
    });

    it("should return nothing for no groups or empty groups", () => {
      // Arrange & Act & Assert
      expect(mergeStatusCounts([])).toEqual([]);
      expect(mergeStatusCounts([[], []])).toEqual([]);
    });
  });

  describe("buildLoadResult", () => {
    const rejected = (file: string, line: number) => ({ file, line, text: "t", reason: "r" });

    it("should sum the inserts, flatten the rejected rows in file order and report the report row counts", () => {
      // Arrange
      const interior = makeParsedFile(AvanceFileKind.INT, [makeRow()], { rejected: [rejected("a", 2), rejected("a", 5)] });
      const montevideo = makeParsedFile(AvanceFileKind.UDPEM, [makeRow()], { rejected: [rejected("b", 3)] });

      // Act
      const result = buildLoadResult({
        dryRun: true,
        files: [loadedFile(AvanceFileKind.INT, { avanceInserted: 3 }), loadedFile(AvanceFileKind.UDPEM, { avanceInserted: 4 })],
        history: { copied: 12, skipped: false, reason: null },
        byStatus: [{ status: "Existente", count: 7 }],
        reports: [
          { kind: ReportKind.DUPLICADO, rows: [["x"], ["y"]], error: null },
          { kind: ReportKind.FUERA_CENTRAL, rows: null, error: "no PostGIS" },
        ],
        elapsedMs: 1234,
        parsed: [interior, montevideo],
      });

      // Assert
      expect(result).toMatchObject({
        dryRun: true,
        avanceInserted: 7,
        elapsedMs: 1234,
        history: { copied: 12, skipped: false, reason: null },
        byStatus: [{ status: "Existente", count: 7 }],
        reports: [
          { kind: ReportKind.DUPLICADO, rows: 2, error: null },
          { kind: ReportKind.FUERA_CENTRAL, rows: null, error: "no PostGIS" },
        ],
      });
      expect(result.rejectedRows.map((row) => [row.file, row.line])).toEqual([["a", 2], ["a", 5], ["b", 3]]);
    });

    describe("rejected total (the capped list is not the count)", () => {
      const baseInput = {
        dryRun: false,
        files: [loadedFile(AvanceFileKind.INT), loadedFile(AvanceFileKind.UDPEM)],
        history: { copied: 0, skipped: false, reason: null },
        byStatus: [],
        reports: [],
        elapsedMs: 1,
      };
      const listOf = (file: string, length: number) => Array.from({ length }, (_, index) => rejected(file, index + 2));

      it("should report the real rejected total across files, not the length of the capped list", () => {
        // Arrange: Interior rejected 250 rows but the list holds the first 200; UDPEM rejected 3
        const interior = makeParsedFile(AvanceFileKind.INT, [makeRow()], { rejected: listOf("a", 200), rejectedTotal: 250 });
        const montevideo = makeParsedFile(AvanceFileKind.UDPEM, [makeRow()], { rejected: listOf("b", 3), rejectedTotal: 3 });

        // Act
        const result = buildLoadResult({ ...baseInput, parsed: [interior, montevideo] });

        // Assert
        expect(result.rejectedRows).toHaveLength(203);
        expect(result.rejectedTotal).toBe(253);
      });

      it("should equal the list length when nothing was capped", () => {
        // Arrange
        const interior = makeParsedFile(AvanceFileKind.INT, [makeRow()], { rejected: listOf("a", 2), rejectedTotal: 2 });
        const montevideo = makeParsedFile(AvanceFileKind.UDPEM, [makeRow()]);

        // Act
        const result = buildLoadResult({ ...baseInput, parsed: [interior, montevideo] });

        // Assert
        expect(result.rejectedRows).toHaveLength(2);
        expect(result.rejectedTotal).toBe(2);
      });

      it("should be zero with no rejected rows and with no parsed files", () => {
        // Arrange
        const clean = [makeParsedFile(AvanceFileKind.INT, [makeRow()]), makeParsedFile(AvanceFileKind.UDPEM, [makeRow()])];

        // Act
        const withFiles = buildLoadResult({ ...baseInput, parsed: clean });
        const withoutFiles = buildLoadResult({ ...baseInput, parsed: [] });

        // Assert
        expect(withFiles.rejectedTotal).toBe(0);
        expect(withoutFiles.rejectedTotal).toBe(0);
      });
    });

    it("should warn about a skipped history copy, unmatched keys and failed reports, in that order", () => {
      // Arrange & Act
      const result = buildLoadResult({
        dryRun: false,
        files: [loadedFile(AvanceFileKind.INT, { unmatchedKeys: 4 }), loadedFile(AvanceFileKind.UDPEM, { unmatchedKeys: 0 })],
        history: { copied: 0, skipped: true, reason: "historial omitido: el Avance actual ya fue cargado hoy" },
        byStatus: [],
        reports: [{ kind: ReportKind.ERROR_ESTADOS, rows: null, error: "timeout" }],
        elapsedMs: 1,
        parsed: [],
      });

      // Assert
      expect(result.warnings).toEqual([
        "historial omitido: el Avance actual ya fue cargado hoy",
        "SituacionFTTH_INT_21092026.csv: 4 claves (edificio, cable, zona) no encontraron zona en SIGRA y no se insertaron.",
        'El reporte "Estados modificados con error" no se pudo generar: timeout',
      ]);
    });

    it("should have no warnings when everything matched, history was copied and every report ran", () => {
      // Arrange & Act
      const result = buildLoadResult({
        dryRun: false,
        files: [loadedFile(AvanceFileKind.INT), loadedFile(AvanceFileKind.UDPEM)],
        history: { copied: 5, skipped: false, reason: null },
        byStatus: [],
        reports: [{ kind: ReportKind.DUPLICADO, rows: [], error: null }],
        elapsedMs: 1,
        parsed: [],
      });

      // Assert
      expect(result.warnings).toEqual([]);
      expect(result.reports).toEqual([{ kind: ReportKind.DUPLICADO, rows: 0, error: null }]);
    });
  });
});
