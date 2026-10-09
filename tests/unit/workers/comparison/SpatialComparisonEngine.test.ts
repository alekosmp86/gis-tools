import { describe, it, expect } from "vitest";
import { SpatialComparisonEngine } from "@/core/workers/comparison/SpatialComparisonEngine";
import { DiscrepancyType, type ColumnMappingConfig } from "@/core/types/comparison";
import type { SerializableFileDataset } from "@/core/types/workerMessages";

type Rec = Record<string, unknown>;

function dataset(rows: Rec[]): SerializableFileDataset {
  const recordsObject: Record<string, Rec> = {};
  rows.forEach((row, index) => {
    recordsObject[String(index)] = row;
  });
  return {
    fileName: "t.csv",
    fileSize: 1,
    featureCount: rows.length,
    attributes: ["id", "name"],
    recordsObject,
  };
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

function run(dbRecords: Rec[], rows: Rec[], mapping: ColumnMappingConfig = config()) {
  return new SpatialComparisonEngine().executeComparison(
    dbRecords,
    undefined,
    dataset(rows),
    mapping,
    "public",
    "tbl"
  );
}

describe("SpatialComparisonEngine.executeComparison (object dataset)", () => {
  describe("placeholder SUID handling", () => {
    it("should match file N/A against DB NULL when treatPlaceholdersAsEmpty is true", () => {
      // Arrange
      const db = [{ id: null, name: "x" }];
      const file = [{ id: "N/A", name: "x" }];

      // Act
      const summary = run(db, file, config({ treatPlaceholdersAsEmpty: true }));

      // Assert
      expect(summary.onlyInShpCount).toBe(0);
      expect(summary.sqlInsertCount).toBe(0);
      expect(summary.items.some((i) => i.type === DiscrepancyType.ONLY_IN_SHP)).toBe(false);
    });

    it("should match file N/A against DB empty string when option is true and both rows share a real value elsewhere", () => {
      // Arrange
      const db = [{ id: "7", name: "x" }, { id: "", name: "y" }];
      const file = [{ id: "7", name: "x" }, { id: "n/a", name: "y" }];

      // Act
      const summary = run(db, file, config({ treatPlaceholdersAsEmpty: true }));

      // Assert
      expect(summary.onlyInShpCount).toBe(0);
      expect(summary.exactMatchesCount).toBe(1);
      expect(summary.sqlInsertCount).toBe(0);
    });

    it.each([undefined, false])(
      "should report ONLY_IN_SHP for file N/A when treatPlaceholdersAsEmpty is %s",
      (flag) => {
        // Arrange
        const db = [{ id: "", name: "x" }];
        const file = [{ id: "N/A", name: "x" }];

        // Act
        const summary = run(db, file, config({ treatPlaceholdersAsEmpty: flag }));

        // Assert
        expect(summary.onlyInShpCount).toBe(1);
        expect(summary.sqlInsertCount).toBe(1);
      }
    );
  });

  describe("file-only duplicate handling", () => {
    it("should insert once and count 2 skipped rows for 3 identical unmatched rows", () => {
      // Arrange
      const file = [1, 2, 3].map(() => ({ id: "A", name: "same" }));

      // Act
      const summary = run([], file);

      // Assert
      expect(summary.onlyInShpCount).toBe(1);
      expect(summary.sqlInsertCount).toBe(1);
      expect(summary.duplicateFileRowsSkipped).toBe(2);
      expect(summary.duplicateSuidCount).toBe(0);
      expect(summary.totalFileRecords).toBe(3);
      expect(summary.totalAnalyzed).toBe(3);
    });

    it("should report 3 DUPLICATE_SUID and no inserts for 3 same-key different-content rows", () => {
      // Arrange
      const file = [{ id: "A", name: "1" }, { id: "A", name: "2" }, { id: "A", name: "3" }];

      // Act
      const summary = run([], file);

      // Assert
      expect(summary.onlyInShpCount).toBe(0);
      expect(summary.sqlInsertCount).toBe(0);
      expect(summary.duplicateSuidCount).toBe(3);
      expect(summary.items.filter((i) => i.type === DiscrepancyType.DUPLICATE_SUID)).toHaveLength(3);
      expect(summary.items.some((i) => i.type === DiscrepancyType.ONLY_IN_SHP)).toBe(false);
      expect(summary.totalAnalyzed).toBe(3);
    });

    it("should treat two rows differing only in a compared attribute as ambiguous", () => {
      // Arrange
      const file = [{ id: "A", name: "1" }, { id: "A", name: "2" }];

      // Act
      const summary = run([], file);

      // Assert
      expect(summary.duplicateSuidCount).toBe(2);
      expect(summary.onlyInShpCount).toBe(0);
    });

    it("should report DUPLICATE_SUID and no inserts for same-key same-attribute rows with different geometry", () => {
      // Arrange
      const file = [
        { id: "A", name: "same", _geometry: { type: "Point", coordinates: [0, 0] } },
        { id: "A", name: "same", _geometry: { type: "Point", coordinates: [5, 5] } },
      ];

      // Act
      const summary = run([], file);

      // Assert
      expect(summary.onlyInShpCount).toBe(0);
      expect(summary.sqlInsertCount).toBe(0);
      expect(summary.duplicateFileRowsSkipped).toBe(0);
      expect(summary.duplicateSuidCount).toBe(2);
      expect(summary.items.filter((i) => i.type === DiscrepancyType.DUPLICATE_SUID)).toHaveLength(2);
      expect(summary.totalAnalyzed).toBe(2);
    });

    it("should report DUPLICATE_SUID and no inserts for same-key same-attribute rows where only one has geometry", () => {
      // Arrange
      const file = [
        { id: "A", name: "same", _geometry: { type: "Point", coordinates: [0, 0] } },
        { id: "A", name: "same" },
      ];

      // Act
      const summary = run([], file);

      // Assert
      expect(summary.onlyInShpCount).toBe(0);
      expect(summary.sqlInsertCount).toBe(0);
      expect(summary.duplicateFileRowsSkipped).toBe(0);
      expect(summary.duplicateSuidCount).toBe(2);
    });

    it("should leave unique unmatched keys unaffected", () => {
      // Arrange
      const file = [{ id: "A", name: "1" }, { id: "B", name: "2" }];

      // Act
      const summary = run([], file);

      // Assert
      expect(summary.onlyInShpCount).toBe(2);
      expect(summary.sqlInsertCount).toBe(2);
      expect(summary.duplicateFileRowsSkipped).toBe(0);
      expect(summary.duplicateSuidCount).toBe(0);
      expect(summary.totalAnalyzed).toBe(2);
    });

    it("should handle an empty file and empty DB", () => {
      // Act
      const summary = run([], []);

      // Assert
      expect(summary.totalAnalyzed).toBe(0);
      expect(summary.onlyInShpCount).toBe(0);
      expect(summary.items).toHaveLength(0);
    });
  });

  describe("accounting in a mixed scenario", () => {
    it("should count every file row and DB row exactly once and sum both duplicate sources", () => {
      // Arrange: DB has matched M, DB-only D, and a DB duplicate pair P (also absent from file).
      const db = [
        { id: "M", name: "m" },
        { id: "D", name: "d" },
        { id: "P", name: "p1" },
        { id: "P", name: "p2" },
      ];
      const file = [
        { id: "M", name: "m" },
        { id: "I", name: "i" },
        { id: "I", name: "i" },
        { id: "I", name: "i" },
        { id: "X", name: "1" },
        { id: "X", name: "2" },
        { id: "U", name: "u" },
        { id: "", name: "nullrow" },
      ];

      // Act
      const summary = run(db, file);

      // Assert
      expect(summary.exactMatchesCount).toBe(1);
      expect(summary.onlyInDbCount).toBe(1);
      expect(summary.onlyInShpCount).toBe(2);
      expect(summary.duplicateFileRowsSkipped).toBe(2);
      expect(summary.nullSuidCount).toBe(1);
      expect(summary.duplicateSuidCount).toBe(4);
      expect(summary.sqlInsertCount).toBe(2);
      // 1 match + 1 db-only + 2 DB-dup rows + file-only (1 U + 3 I + 2 X) + 1 null row
      expect(summary.totalAnalyzed).toBe(1 + 1 + 2 + 6 + 1);
    });
  });
});
