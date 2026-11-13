import { describe, expect, it } from "vitest";
import { SpatialComparisonEngine } from "@/core/workers/comparison/SpatialComparisonEngine";
import { DEGENERATE_EXAMPLE_LIMIT } from "@/core/workers/comparison/DegenerateGeometry";
import { DiscrepancyType, type ColumnMappingConfig } from "@/core/types/comparison";
import type { SerializableFileDataset } from "@/core/types/workerMessages";

type Rec = Record<string, unknown>;

const GOOD = { type: "LineString", coordinates: [[-56.1, -34.9], [-56.2, -34.8]] };
const COLLAPSED = {
  type: "MultiLineString",
  coordinates: [[[6.6e5, 6.15e6], [6.6e5 + 3.5e-10, 6.15e6]]],
};

function dataset(rows: Rec[]): SerializableFileDataset {
  const recordsObject: Record<string, Rec> = {};
  rows.forEach((row, index) => {
    recordsObject[String(index)] = row;
  });
  return { fileName: "t.csv", fileSize: 1, featureCount: rows.length, attributes: ["id", "name"], recordsObject };
}

function config(overrides: Partial<ColumnMappingConfig> = {}): ColumnMappingConfig {
  return {
    suidColumns: ["id"],
    matchedFileSuidColumns: ["id"],
    fieldsToCompare: ["name"],
    compareGeometry: false,
    ...overrides,
  };
}

const run = (dbRecords: Rec[], rows: Rec[], mapping: ColumnMappingConfig = config()) =>
  new SpatialComparisonEngine().executeComparison(dbRecords, undefined, dataset(rows), mapping, "public", "tbl");

describe("SpatialComparisonEngine degenerate file rows (DG-2, DG-3, DG-4)", () => {
  describe("a file without degenerate rows", () => {
    it("should leave the summary fields absent and the counts as they were", () => {
      const summary = run([{ id: "A", name: "x" }], [{ id: "A", name: "x", _geometry: GOOD }, { id: "B", name: "y", _geometry: GOOD }]);

      expect(summary).not.toHaveProperty("degenerateFileRowsSkipped");
      expect(summary).not.toHaveProperty("degenerateFileExamples");
      expect(summary.exactMatchesCount).toBe(1);
      expect(summary.onlyInShpCount).toBe(1);
      expect(summary.totalFileRecords).toBe(2);
      expect(summary.totalAnalyzed).toBe(2);
    });

    it("should give identical counts for rows with a point or no geometry", () => {
      const summary = run([], [{ id: "A", name: "x", _geometry: { type: "Point", coordinates: [1, 1] } }, { id: "B", name: "y" }]);

      expect(summary.onlyInShpCount).toBe(2);
      expect(summary).not.toHaveProperty("degenerateFileRowsSkipped");
    });
  });

  describe("a file with degenerate rows", () => {
    it("should never insert a degenerate row, never report it as only in the file, and count it as skipped", () => {
      const summary = run([], [{ id: "A", name: "x", _geometry: COLLAPSED }, { id: "B", name: "y", _geometry: GOOD }]);

      expect(summary.degenerateFileRowsSkipped).toBe(1);
      expect(summary.onlyInShpCount).toBe(1);
      expect(summary.sqlInsertCount).toBe(1);
      expect(summary.items.filter((item) => item.type === DiscrepancyType.ONLY_IN_SHP)).toHaveLength(1);
    });

    it("should keep the degenerate key out of the INSERT preview and count one insert", () => {
      const summary = new SpatialComparisonEngine().executeComparison(
        [],
        { id: "text", name: "text", geom: "geometry(MultiLineString,32721)" },
        dataset([{ id: "BADKEY", name: "x", _geometry: COLLAPSED }, { id: "GOODKEY", name: "y", _geometry: GOOD }]),
        config({ compareGeometry: true, fieldsToCompare: ["name", "geom"], targetSrid: 32721 }),
        "public",
        "tbl"
      );

      expect(summary.sqlInsertCount).toBe(1);
      expect(summary.sqlInsertPreview).toContain("GOODKEY");
      expect(summary.sqlInsertPreview).not.toContain("BADKEY");
    });

    it("should leave an INSERT script empty when the only file row is degenerate", () => {
      const summary = run([], [{ id: "A", name: "x", _geometry: COLLAPSED }]);

      expect(summary.sqlInsertCount).toBe(0);
      expect(summary.onlyInShpCount).toBe(0);
      expect(summary.degenerateFileRowsSkipped).toBe(1);
    });

    it("should report the DB row of a key whose only file row is degenerate as ONLY_IN_DB, with no UPDATE", () => {
      const summary = run([{ id: "A", name: "old" }], [{ id: "A", name: "new", _geometry: COLLAPSED }]);

      expect(summary.onlyInDbCount).toBe(1);
      expect(summary.items.some((item) => item.type === DiscrepancyType.ONLY_IN_DB)).toBe(true);
      expect(summary.sqlUpdateCount).toBe(0);
      expect(summary.exactMatchesCount).toBe(0);
      expect(summary.attributeMismatchCount).toBe(0);
      expect(summary.degenerateFileRowsSkipped).toBe(1);
    });

    it("should pair the valid row of a key that also has a degenerate row, and skip the degenerate one", () => {
      const summary = run([{ id: "A", name: "x" }], [{ id: "A", name: "x", _geometry: COLLAPSED }, { id: "A", name: "x", _geometry: GOOD }]);

      expect(summary.exactMatchesCount).toBe(1);
      expect(summary.onlyInDbCount).toBe(0);
      expect(summary.duplicateSuidCount).toBe(0);
      expect(summary.degenerateFileRowsSkipped).toBe(1);
    });

    it("should not treat a degenerate row as a file-side duplicate of a valid one", () => {
      const summary = run([], [{ id: "A", name: "x", _geometry: COLLAPSED }, { id: "A", name: "x", _geometry: GOOD }]);

      expect(summary.duplicateFileRowsSkipped ?? 0).toBe(0);
      expect(summary.onlyInShpCount).toBe(1);
    });

    it("should add the degenerate rows to the analyzed total so every file row is accounted for once", () => {
      const file = [
        { id: "A", name: "x", _geometry: GOOD },
        { id: "B", name: "y", _geometry: GOOD },
        { id: "C", name: "z", _geometry: COLLAPSED },
        { id: "D", name: "w", _geometry: COLLAPSED },
      ];

      const summary = run([], file);

      expect(summary.totalFileRecords).toBe(4);
      expect(summary.degenerateFileRowsSkipped).toBe(2);
      expect(summary.totalAnalyzed).toBe(4);
      const reconciled =
        summary.exactMatchesCount +
        summary.attributeMismatchCount +
        summary.geometryMismatchCount +
        summary.onlyInShpCount +
        summary.duplicateSuidCount +
        (summary.duplicateFileRowsSkipped ?? 0) +
        (summary.degenerateFileRowsSkipped ?? 0);
      expect(reconciled).toBe(summary.totalFileRecords - summary.nullSuidCount);
    });

    it("should carry the row number and the key values of the skipped rows as examples, in file order", () => {
      const summary = run(
        [],
        [
          { id: "A", name: "x", _geometry: GOOD },
          { id: "BAD1", name: "y", _geometry: COLLAPSED },
          { id: "B", name: "z", _geometry: GOOD },
          { id: "BAD2", name: "w", _geometry: COLLAPSED },
        ]
      );

      expect(summary.degenerateFileExamples).toEqual([
        { rowNumber: 2, suid: "BAD1" },
        { rowNumber: 4, suid: "BAD2" },
      ]);
    });

    it("should carry at most 20 examples while counting all the skipped rows", () => {
      const rows = Array.from({ length: 25 }, (_, index) => ({ id: `K${index}`, name: "x", _geometry: COLLAPSED }));

      const summary = run([], rows);

      expect(summary.degenerateFileRowsSkipped).toBe(25);
      expect(summary.degenerateFileExamples).toHaveLength(DEGENERATE_EXAMPLE_LIMIT);
    });

    it("should build the example key from a composite key", () => {
      const summary = new SpatialComparisonEngine().executeComparison(
        [],
        undefined,
        dataset([{ id: "A", name: "n1", _geometry: COLLAPSED }]),
        config({ suidColumns: ["id", "name"], matchedFileSuidColumns: ["id", "name"] }),
        "public",
        "tbl"
      );

      expect(summary.degenerateFileExamples?.[0].rowNumber).toBe(1);
      expect(summary.degenerateFileExamples?.[0].suid).toContain("A");
      expect(summary.degenerateFileExamples?.[0].suid).toContain("n1");
    });

    it("should skip a degenerate row with a null key as degenerate, not as a null-SUID row", () => {
      const summary = run([], [{ id: "", name: "x", _geometry: COLLAPSED }, { id: "", name: "y", _geometry: GOOD }]);

      expect(summary.degenerateFileRowsSkipped).toBe(1);
      expect(summary.nullSuidCount).toBe(1);
      expect(summary.degenerateFileExamples).toEqual([{ rowNumber: 1, suid: "" }]);
    });

    it("should also skip a degenerate row when geometry comparison is on", () => {
      const summary = run(
        [{ id: "A", name: "x" }],
        [{ id: "A", name: "x", _geometry: COLLAPSED }],
        config({ compareGeometry: true, fieldsToCompare: ["name", "geom"] })
      );

      expect(summary.geometryMismatchCount).toBe(0);
      expect(summary.onlyInDbCount).toBe(1);
      expect(summary.degenerateFileRowsSkipped).toBe(1);
    });
  });
});
