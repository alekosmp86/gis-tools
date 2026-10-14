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
      // Arrange: DB has matched M, DB-only D, and a distinct same-key pair P absent from the file
      // (two ONLY_IN_DB rows, no longer DUPLICATE_SUID).
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
      expect(summary.onlyInDbCount).toBe(3);
      expect(summary.onlyInShpCount).toBe(2);
      expect(summary.duplicateFileRowsSkipped).toBe(2);
      expect(summary.nullSuidCount).toBe(1);
      expect(summary.duplicateSuidCount).toBe(2);
      expect(summary.sqlInsertCount).toBe(2);
      // 1 match + 3 db-only (D, P1, P2) + file-only (1 U + 3 I + 2 X) + 1 null row
      expect(summary.totalAnalyzed).toBe(1 + 3 + 6 + 1);
      expect(summary.items.filter((i) => i.type === DiscrepancyType.ONLY_IN_DB)).toHaveLength(3);
    });
  });

  describe("non-unique key pairing", () => {
    const P0 = { type: "Point", coordinates: [0, 0] };
    const pointAt = (x: number) => ({ type: "Point", coordinates: [x, 0] });
    const geoConfig = (overrides: Partial<ColumnMappingConfig> = {}) =>
      config({ fieldsToCompare: ["name"], compareGeometry: true, ...overrides });

    it("should pair the Artigas case into one match and one attribute mismatch with no duplicates", () => {
      // Arrange
      const db = [
        { id: "K", name: "ARTIGAS", geom: P0 },
        { id: "K", name: "N/A", geom: P0 },
      ];
      const file = [
        { id: "K", name: "ARTIGAS RURAL", _geometry: P0 },
        { id: "K", name: "ARTIGAS", _geometry: P0 },
      ];

      // Act
      const summary = run(db, file, geoConfig());

      // Assert
      expect(summary.exactMatchesCount).toBe(1);
      expect(summary.attributeMismatchCount).toBe(1);
      expect(summary.duplicateSuidCount).toBe(0);
      expect(summary.onlyInDbCount).toBe(0);
      expect(summary.onlyInShpCount).toBe(0);
      expect(summary.totalFileRecords).toBe(2);
      expect(summary.totalAnalyzed).toBe(2);
      expect(summary.pairingCappedGroups).toBe(0);
    });

    it("should skip the UPDATE for a paired row without a primary key and count it as unkeyed", () => {
      // Arrange
      const db = [
        { id: "K", name: "ARTIGAS", geom: P0 },
        { id: "K", name: "N/A", geom: P0 },
      ];
      const file = [
        { id: "K", name: "ARTIGAS", _geometry: P0 },
        { id: "K", name: "ARTIGAS RURAL", _geometry: P0 },
      ];

      // Act
      const summary = run(db, file, geoConfig());

      // Assert
      expect(summary.attributeMismatchCount).toBe(1);
      expect(summary.unkeyedUpdatesSkippedCount).toBe(1);
      expect(summary.sqlUpdateCount).toBe(0);
      expect(summary.sqlUpdatePreview).toBe("");
    });

    it("should emit one UPDATE keyed by the primary key for a paired row that has one", () => {
      // Arrange
      const db = [
        { pk: 11, id: "K", name: "ARTIGAS", geom: P0 },
        { pk: 12, id: "K", name: "N/A", geom: P0 },
      ];
      const file = [
        { id: "K", name: "ARTIGAS", _geometry: P0 },
        { id: "K", name: "ARTIGAS RURAL", _geometry: P0 },
      ];

      // Act
      const summary = run(db, file, geoConfig({ primaryKeyColumn: "pk" }));

      // Assert
      expect(summary.unkeyedUpdatesSkippedCount).toBe(0);
      expect(summary.sqlUpdateCount).toBe(1);
      expect(summary.sqlUpdatePreview).toContain('WHERE "pk" = 12');
      expect(summary.sqlUpdatePreview).toContain("ARTIGAS RURAL");
    });

    it("should still emit the composite-key UPDATE for a 1:1 key without a primary key", () => {
      // Arrange
      const db = [{ id: "K", name: "old" }];
      const file = [{ id: "K", name: "new" }];

      // Act
      const summary = run(db, file);

      // Assert
      expect(summary.unkeyedUpdatesSkippedCount).toBe(0);
      expect(summary.sqlUpdateCount).toBe(1);
      expect(summary.sqlUpdatePreview).toContain('WHERE "id" = ');
    });

    it("should insert a leftover file row of a colliding key and count it in inserts and onlyInShp", () => {
      // Arrange: D=1, F=2 distinct rows; the file row that is not paired becomes an insert.
      const db = [{ id: "K", name: "a", geom: pointAt(0) }];
      const file = [
        { id: "K", name: "a", _geometry: pointAt(0) },
        { id: "K", name: "extra", _geometry: pointAt(50) },
      ];

      // Act
      const summary = run(db, file, geoConfig());

      // Assert
      expect(summary.exactMatchesCount).toBe(1);
      expect(summary.onlyInShpCount).toBe(1);
      expect(summary.sqlInsertCount).toBe(1);
      expect(summary.sqlInsertPreview).toContain("INSERT INTO");
      expect(summary.sqlInsertPreview).toContain("extra");
      expect(summary.duplicateSuidCount).toBe(0);
      expect(summary.items.filter((i) => i.type === DiscrepancyType.ONLY_IN_SHP)).toHaveLength(1);
      expect(summary.totalAnalyzed).toBe(2);
    });

    it("should report a DB-side twin as DUPLICATE_SUID and skip the file-side twin", () => {
      // Arrange
      const row = { id: "K", name: "same", geom: P0 };
      const db = [{ ...row }, { ...row }];
      const file = [
        { id: "K", name: "same", _geometry: P0 },
        { id: "K", name: "same", _geometry: P0 },
      ];

      // Act
      const summary = run(db, file, geoConfig());

      // Assert
      expect(summary.exactMatchesCount).toBe(1);
      expect(summary.duplicateSuidCount).toBe(1);
      expect(summary.duplicateFileRowsSkipped).toBe(1);
      expect(summary.totalAnalyzed).toBe(3);
    });

    it("should add pass-1 file duplicates and pass-2 duplicates into duplicateSuidCount", () => {
      // Arrange: key A (in DB) has 2 unpairable no-geometry rows each side; key X (file-only) is ambiguous.
      const db = [
        { id: "A", name: "1" },
        { id: "A", name: "2" },
      ];
      const file = [
        { id: "A", name: "3" },
        { id: "A", name: "4" },
        { id: "X", name: "p" },
        { id: "X", name: "q" },
      ];

      // Act
      const summary = run(db, file);

      // Assert
      expect(summary.duplicateSuidCount).toBe(2 + 2 + 2);
      expect(summary.items.filter((i) => i.type === DiscrepancyType.DUPLICATE_SUID)).toHaveLength(6);
      expect(summary.totalAnalyzed).toBe(6);
      expect(summary.sqlInsertCount).toBe(0);
    });

    it("should skip geometry pairing for a group above the candidate cap and count it once", () => {
      // Arrange: key BIG has 201 x 201 = 40,401 geometry candidates (> 40,000) plus one exact pair
      // (Stage A still pairs); key SMALL is a normal collision group.
      const bigDb: Rec[] = [];
      const bigFile: Rec[] = [];
      for (let index = 0; index < 201; index++) {
        bigDb.push({ id: "BIG", name: `d${index}`, geom: pointAt(index * 10) });
        bigFile.push({ id: "BIG", name: `f${index}`, _geometry: pointAt(index * 10 + 1) });
      }
      bigDb.push({ id: "BIG", name: "same", geom: pointAt(-100) });
      bigFile.push({ id: "BIG", name: "same", _geometry: pointAt(-100) });
      const smallDb = [
        { id: "SMALL", name: "a", geom: pointAt(0) },
        { id: "SMALL", name: "b", geom: pointAt(10) },
      ];
      const smallFile = [
        { id: "SMALL", name: "a2", _geometry: pointAt(0) },
        { id: "SMALL", name: "b2", _geometry: pointAt(10) },
      ];

      // Act
      const summary = run([...bigDb, ...smallDb], [...bigFile, ...smallFile], geoConfig());

      // Assert
      expect(summary.pairingCappedGroups).toBe(1);
      expect(summary.exactMatchesCount).toBe(1);
      expect(summary.attributeMismatchCount).toBe(2);
      expect(summary.duplicateSuidCount).toBe(402);
      expect(summary.onlyInShpCount).toBe(0);
      expect(summary.sqlInsertCount).toBe(0);
      const capped = summary.items.filter(
        (item) => item.type === DiscrepancyType.DUPLICATE_SUID
      );
      expect(capped).toHaveLength(402);
      expect(capped.every((item) => item.pairing?.method === "SKIPPED_CAP")).toBe(true);
      const ids = summary.items.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(summary.totalAnalyzed).toBe(1 + 2 + 402);
    });

    it("should reconcile totals on a mixed dataset including null SUID rows and keep ids unique", () => {
      // Arrange
      const db = [
        { id: "M", name: "m" },
        { id: "P", name: "p1" },
        { id: "P", name: "p2" },
        { id: "Q", name: "q" },
        { id: "Q", name: "q" },
        { id: null, name: "nulldb" },
      ];
      const file = [
        { id: "M", name: "m" },
        { id: "Q", name: "q" },
        { id: "Q", name: "q" },
        { id: "Q", name: "q" },
        { id: "N1", name: "n" },
        { id: "N1", name: "n" },
        { id: "", name: "nullfile" },
      ];

      // Act
      const summary = run(db, file);

      // Assert
      const count = (type: DiscrepancyType) => summary.items.filter((i) => i.type === type).length;
      expect(summary.exactMatchesCount).toBe(2);
      expect(summary.onlyInDbCount).toBe(2);
      expect(summary.duplicateSuidCount).toBe(1);
      expect(summary.duplicateFileRowsSkipped).toBe(3);
      expect(summary.onlyInShpCount).toBe(1);
      expect(summary.nullSuidCount).toBe(1);
      expect(count(DiscrepancyType.DUPLICATE_SUID)).toBe(summary.duplicateSuidCount);
      expect(count(DiscrepancyType.ONLY_IN_DB)).toBe(summary.onlyInDbCount);
      expect(count(DiscrepancyType.ONLY_IN_SHP)).toBe(summary.onlyInShpCount);
      // every file row is accounted for exactly once
      const fileRowsAccounted =
        summary.exactMatchesCount +
        summary.attributeMismatchCount +
        summary.geometryMismatchCount +
        summary.onlyInShpCount +
        (summary.duplicateFileRowsSkipped ?? 0) +
        summary.nullSuidCount;
      expect(fileRowsAccounted).toBe(summary.totalFileRecords);
      const ids = summary.items.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
