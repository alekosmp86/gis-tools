import { describe, it, expect } from "vitest";
import {
  MatchedRecordsComparator,
  type CompareMatchedRecordsParams,
  type MatchedComparisonResult,
} from "@/core/workers/comparison/MatchedRecordsComparator";
import { SuidKeyResolver } from "@/core/workers/comparison/SuidKeyResolver";
import { FeatureAttributeExtractor } from "@/core/workers/comparison/FeatureAttributeExtractor";
import { GeometryDifferenceEvaluator } from "@/core/workers/comparison/GeometryDifferenceEvaluator";
import { FileDatasetIndexer } from "@/core/workers/comparison/FileDatasetIndexer";
import { BinaryDbfReader, type DbfFieldDescriptor } from "@/core/binary/BinaryDbfReader";
import type { BinaryShpReader } from "@/core/binary/BinaryShpReader";
import {
  DiscrepancyType,
  PairingMethod,
  type ColumnMappingConfig,
  type DiscrepancyItem,
} from "@/core/types/comparison";

type Rec = Record<string, unknown>;

const resolver = new SuidKeyResolver();
const comparator = new MatchedRecordsComparator(
  resolver,
  new FeatureAttributeExtractor(resolver),
  new GeometryDifferenceEvaluator()
);

const point = (x: number, y: number) => ({ type: "Point", coordinates: [x, y] });
const P0 = point(0, 0);
const P5 = point(5, 5);

function baseMapping(overrides: Partial<ColumnMappingConfig> = {}): ColumnMappingConfig {
  return {
    suidColumns: ["id"],
    matchedFileSuidColumns: ["id"],
    fieldsToCompare: ["localidad"],
    compareGeometry: true,
    ...overrides,
  };
}

function keyOf(record: Rec, columns: string[]): string {
  return resolver.buildCompositeKey(record, columns);
}

function groupBy<T extends Rec>(rows: T[], columns: string[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row, columns);
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

function baseParams(mapping: ColumnMappingConfig): CompareMatchedRecordsParams {
  const fieldToFileKey = new Map<string, string>();
  mapping.fieldsToCompare.forEach((field) => fieldToFileKey.set(field, field));
  return {
    dbSuidMap: new Map(),
    dbSuidCols: mapping.suidColumns,
    targetFileSuidCols: mapping.matchedFileSuidColumns,
    fieldsToCompare: mapping.fieldsToCompare,
    fieldToFileKey,
    binaryFileSuidMap: new Map(),
    objectFileSuidMap: new Map(),
    dbfReader: null,
    shpReader: null,
    transformCoordinate: null,
    dbfCompareFields: new Map(),
    mappingConfig: mapping,
    emit: () => {},
  };
}

function runObjects(
  dbRows: Rec[],
  fileRows: Rec[],
  mappingOverrides: Partial<ColumnMappingConfig> = {}
): MatchedComparisonResult {
  const mapping = baseMapping(mappingOverrides);
  return comparator.compareMatchedRecords({
    ...baseParams(mapping),
    dbSuidMap: groupBy(dbRows, mapping.suidColumns),
    objectFileSuidMap: groupBy(fileRows, mapping.matchedFileSuidColumns ?? mapping.suidColumns),
  });
}

function makeDbf(fields: string[], rows: string[][], width = 24): Uint8Array {
  const headerLength = 32 + 32 * fields.length + 1;
  const recordLength = 1 + width * fields.length;
  const bytes = new Uint8Array(headerLength + recordLength * rows.length).fill(0x20);
  const view = new DataView(bytes.buffer);
  bytes.fill(0, 0, headerLength);
  bytes[0] = 3;
  view.setUint32(4, rows.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);
  fields.forEach((name, fieldIndex) => {
    const offset = 32 + 32 * fieldIndex;
    for (let char = 0; char < name.length; char++) bytes[offset + char] = name.charCodeAt(char);
    bytes[offset + 11] = "C".charCodeAt(0);
    bytes[offset + 16] = width;
  });
  bytes[headerLength - 1] = 0x0d;
  rows.forEach((values, rowIndex) => {
    const start = headerLength + rowIndex * recordLength;
    bytes[start] = 0x20;
    values.forEach((value, fieldIndex) => {
      const offset = start + 1 + fieldIndex * width;
      for (let char = 0; char < value.length; char++) bytes[offset + char] = value.charCodeAt(char);
    });
  });
  return bytes;
}

function runDbf(
  dbRows: Rec[],
  fileRows: string[][],
  fileGeometries: unknown[] | null,
  mappingOverrides: Partial<ColumnMappingConfig> = {}
): MatchedComparisonResult {
  const mapping = baseMapping(mappingOverrides);
  const reader = new BinaryDbfReader(makeDbf(["id", "localidad"], fileRows));
  const dbfCompareFields = new Map<string, DbfFieldDescriptor>();
  for (const field of mapping.fieldsToCompare) {
    const descriptor = reader.header.fields.find((candidate) => candidate.name === field);
    if (descriptor) dbfCompareFields.set(field, descriptor);
  }
  const shpReader = fileGeometries
    ? ({
        readGeometry: (recordIndex: number) => fileGeometries[recordIndex] ?? null,
      } as unknown as BinaryShpReader)
    : null;
  return comparator.compareMatchedRecords({
    ...baseParams(mapping),
    dbSuidMap: groupBy(dbRows, mapping.suidColumns),
    binaryFileSuidMap: new FileDatasetIndexer(resolver).indexBinaryDbf(
      reader,
      mapping.matchedFileSuidColumns ?? mapping.suidColumns
    ).suidMap,
    dbfReader: reader,
    shpReader,
    dbfCompareFields,
  });
}

function ofType(items: DiscrepancyItem[], type: DiscrepancyType): DiscrepancyItem[] {
  return items.filter((item) => item.type === type);
}

function allIds(result: MatchedComparisonResult): string[] {
  return [...result.discrepancyItems, ...result.unmatchedFileItems].map((item) => item.id);
}

const KEY = keyOf({ id: "K" }, ["id"]);

describe("MatchedRecordsComparator", () => {
  describe("1:1 keys (unchanged behaviour)", () => {
    it("should count an identical pair as an exact match and emit no item", () => {
      // Arrange
      const db = [{ id: "K", localidad: "A", geom: P0 }];
      const file = [{ id: "K", localidad: "A", _geometry: P0 }];

      // Act
      const result = runObjects(db, file);

      // Assert
      expect(result.counts.exactMatchesCount).toBe(1);
      expect(result.discrepancyItems).toEqual([]);
      expect(result.unmatchedFileItems).toEqual([]);
      expect(result.pairingCappedGroups).toBe(0);
    });

    it("should emit a byte-identical ATTRIBUTE_MISMATCH item without pairing metadata", () => {
      // Arrange
      const dbRecord = { id: "K", localidad: "old", geom: P0 };
      const fileRecord = { id: "K", localidad: "new", _geometry: P0 };

      // Act
      const result = runObjects([dbRecord], [fileRecord]);

      // Assert
      expect(result.discrepancyItems).toHaveLength(1);
      const item = result.discrepancyItems[0];
      expect(item).toEqual({
        id: `match-${KEY}-0`,
        suid: "K",
        type: DiscrepancyType.ATTRIBUTE_MISMATCH,
        differences: [{ fieldName: "localidad", dbValue: "old", shpValue: "new" }],
        geometryDifference: undefined,
        dbRecord,
        shpFeatureProps: fileRecord,
        shpGeometry: P0,
        fileRecordIndex: undefined,
        duplicateDetails: undefined,
        note: undefined,
      });
      expect(Object.keys(item)).not.toContain("pairing");
      expect(result.counts.attributeMismatchCount).toBe(1);
    });

    it("should emit a GEOMETRY_MISMATCH item without pairing metadata when only geometry differs", () => {
      // Arrange
      const db = [{ id: "K", localidad: "A", geom: P0 }];
      const file = [{ id: "K", localidad: "A", _geometry: P5 }];

      // Act
      const result = runObjects(db, file);

      // Assert
      const item = result.discrepancyItems[0];
      expect(item.type).toBe(DiscrepancyType.GEOMETRY_MISMATCH);
      expect(item.differences).toEqual([]);
      expect(item.geometryDifference?.dbGeomRaw).toEqual(P0);
      expect(item.geometryDifference?.fileGeomRaw).toEqual(P5);
      expect(Object.keys(item)).not.toContain("pairing");
      expect(result.counts.geometryMismatchCount).toBe(1);
    });

    it("should give geometry precedence over attribute differences", () => {
      // Arrange
      const db = [{ id: "K", localidad: "old", geom: P0 }];
      const file = [{ id: "K", localidad: "new", _geometry: P5 }];

      // Act
      const result = runObjects(db, file);

      // Assert
      expect(result.discrepancyItems[0].type).toBe(DiscrepancyType.GEOMETRY_MISMATCH);
      expect(result.discrepancyItems[0].differences).toHaveLength(1);
      expect(result.counts.geometryMismatchCount).toBe(1);
      expect(result.counts.attributeMismatchCount).toBe(0);
    });

    it("should emit ONLY_IN_DB with id db-key-0 when the key is absent from the file", () => {
      // Act
      const result = runObjects([{ id: "K", localidad: "A" }], []);

      // Assert
      expect(result.discrepancyItems).toEqual([
        {
          id: `db-${KEY}-0`,
          suid: "K",
          type: DiscrepancyType.ONLY_IN_DB,
          differences: [],
          duplicateDetails: undefined,
          note: undefined,
        },
      ]);
      expect(result.counts.onlyInDbCount).toBe(1);
    });

    it("should never touch file-only keys (D == 0 stays in pass 2)", () => {
      // Act
      const result = runObjects([], [{ id: "K", localidad: "A" }, { id: "K", localidad: "B" }]);

      // Assert
      expect(result.discrepancyItems).toEqual([]);
      expect(result.unmatchedFileItems).toEqual([]);
      expect(result.processedSuids.size).toBe(0);
    });

    it("should not geometry-mismatch a 1:1 pair when compareGeometry is false", () => {
      // Arrange
      const db = [{ id: "K", localidad: "A", geom: P0 }];
      const file = [{ id: "K", localidad: "A", _geometry: P5 }];

      // Act
      const result = runObjects(db, file, { compareGeometry: false });

      // Assert
      expect(result.counts.exactMatchesCount).toBe(1);
      expect(result.counts.geometryMismatchCount).toBe(0);
    });
  });

  describe("collision groups on the object dataset path", () => {
    it("should pair the Artigas case into 1 MATCH and 1 ATTRIBUTE_MISMATCH with no duplicates", () => {
      // Arrange: both rows share the same coordinates; only the localidad differs.
      const db = [
        { id: "K", localidad: "ARTIGAS", geom: P0 },
        { id: "K", localidad: "N/A", geom: P0 },
      ];
      const file = [
        { id: "K", localidad: "ARTIGAS RURAL", _geometry: P0 },
        { id: "K", localidad: "ARTIGAS", _geometry: P0 },
      ];

      // Act
      const result = runObjects(db, file);

      // Assert
      expect(result.counts.exactMatchesCount).toBe(1);
      expect(result.counts.attributeMismatchCount).toBe(1);
      expect(result.counts.duplicateSuidCount).toBe(0);
      expect(result.counts.duplicateSuidFileCount).toBe(0);
      expect(result.counts.onlyInDbCount).toBe(0);
      expect(result.counts.onlyInFileCount).toBe(0);
      expect(result.discrepancyItems).toHaveLength(1);
      const item = result.discrepancyItems[0];
      expect(item.type).toBe(DiscrepancyType.ATTRIBUTE_MISMATCH);
      expect(item.id).toBe(`match-${KEY}-1`);
      expect(item.differences).toEqual([
        { fieldName: "localidad", dbValue: "N/A", shpValue: "ARTIGAS RURAL" },
      ]);
      expect(item.pairing).toEqual({
        method: PairingMethod.GEOMETRY,
        dbCount: 2,
        fileCount: 2,
        distance: 0,
      });
    });

    it("should report a letra column inside the key as separate 1:1 keys with no pairing", () => {
      // Arrange
      const db = [
        { id: "K", letra: "A", localidad: "x", geom: P0 },
        { id: "K", letra: "B", localidad: "y", geom: P0 },
      ];
      const file = [
        { id: "K", letra: "A", localidad: "x", _geometry: P0 },
        { id: "K", letra: "B", localidad: "y2", _geometry: P0 },
      ];

      // Act
      const result = runObjects(db, file, {
        suidColumns: ["id", "letra"],
        matchedFileSuidColumns: ["id", "letra"],
      });

      // Assert
      expect(result.counts.exactMatchesCount).toBe(1);
      expect(result.counts.attributeMismatchCount).toBe(1);
      expect(result.discrepancyItems).toHaveLength(1);
      expect(result.discrepancyItems[0].pairing).toBeUndefined();
      expect(result.discrepancyItems[0].id).toBe(`match-${keyOf({ id: "K", letra: "B" }, ["id", "letra"])}-0`);
    });

    it("should pair a letra compared as a field (not in the key) through the colliding group", () => {
      // Arrange
      const db = [
        { id: "K", letra: "A", localidad: "x", geom: P0 },
        { id: "K", letra: "B", localidad: "y", geom: P5 },
      ];
      const file = [
        { id: "K", letra: "B", localidad: "y2", _geometry: P5 },
        { id: "K", letra: "A", localidad: "x", _geometry: P0 },
      ];

      // Act
      const result = runObjects(db, file, { fieldsToCompare: ["letra", "localidad"] });

      // Assert
      expect(result.counts.exactMatchesCount).toBe(1);
      expect(result.counts.attributeMismatchCount).toBe(1);
      expect(result.counts.duplicateSuidCount).toBe(0);
      expect(result.discrepancyItems[0].differences).toEqual([
        { fieldName: "localidad", dbValue: "y", shpValue: "y2" },
      ]);
    });

    it("should pair 2 of 3 DB rows and report the unmatched DB row as ONLY_IN_DB (D=3, F=2)", () => {
      // Arrange
      const db = [
        { id: "K", localidad: "a0", geom: point(0, 0) },
        { id: "K", localidad: "a1", geom: point(10, 0) },
        { id: "K", localidad: "a2", geom: point(20, 0) },
      ];
      const file = [
        { id: "K", localidad: "a0x", _geometry: point(0, 0) },
        { id: "K", localidad: "a2x", _geometry: point(20, 0) },
      ];

      // Act
      const result = runObjects(db, file);

      // Assert
      expect(ofType(result.discrepancyItems, DiscrepancyType.ATTRIBUTE_MISMATCH)).toHaveLength(2);
      const onlyInDb = ofType(result.discrepancyItems, DiscrepancyType.ONLY_IN_DB);
      expect(onlyInDb.map((item) => item.id)).toEqual([`db-${KEY}-1`]);
      expect(result.counts.onlyInDbCount).toBe(1);
      expect(result.counts.duplicateSuidCount).toBe(0);
      expect(result.unmatchedFileItems).toEqual([]);
    });

    it("should pair 2 of 3 file rows and emit the leftover file row as an insert item (D=2, F=3)", () => {
      // Arrange
      const db = [
        { id: "K", localidad: "a0", geom: point(0, 0) },
        { id: "K", localidad: "a2", geom: point(20, 0) },
      ];
      const leftover = { id: "K", localidad: "a1x", _geometry: point(10, 0) };
      const file = [
        { id: "K", localidad: "a0x", _geometry: point(0, 0) },
        leftover,
        { id: "K", localidad: "a2x", _geometry: point(20, 0) },
      ];

      // Act
      const result = runObjects(db, file);

      // Assert
      expect(ofType(result.discrepancyItems, DiscrepancyType.ATTRIBUTE_MISMATCH)).toHaveLength(2);
      expect(result.unmatchedFileItems).toHaveLength(1);
      expect(result.unmatchedFileItems[0].type).toBe(DiscrepancyType.ONLY_IN_SHP);
      expect(result.unmatchedFileItems[0].id).toBe(`file-${KEY}-1`);
      expect(result.unmatchedFileItems[0].shpFeatureProps).toBe(leftover);
      expect(result.counts.onlyInFileCount).toBe(1);
      expect(result.counts.duplicateSuidCount).toBe(0);
      expect(result.counts.onlyInDbCount).toBe(0);
    });

    it("should collapse identical true duplicates on both sides to one match, one DB duplicate and one skipped file row", () => {
      // Arrange
      const row = { id: "K", localidad: "A", geom: P0 };
      const db = [{ ...row }, { ...row }];
      const file = [
        { id: "K", localidad: "A", _geometry: P0 },
        { id: "K", localidad: "A", _geometry: P0 },
      ];

      // Act
      const result = runObjects(db, file);

      // Assert
      expect(result.counts.exactMatchesCount).toBe(1);
      expect(result.counts.duplicateSuidCount).toBe(1);
      expect(result.counts.duplicateFileRowsSkipped).toBe(1);
      expect(result.counts.duplicateSuidFileCount).toBe(0);
      expect(result.discrepancyItems).toHaveLength(1);
      const duplicate = result.discrepancyItems[0];
      expect(duplicate.type).toBe(DiscrepancyType.DUPLICATE_SUID);
      expect(duplicate.id).toBe(`db-${KEY}-1`);
      expect(duplicate.duplicateDetails).toEqual({ targetCount: 2, sourceCount: 2 });
      expect(result.unmatchedFileItems).toEqual([]);
    });

    it("should skip extra identical file rows silently (D=1, F=2 identical)", () => {
      // Arrange
      const db = [{ id: "K", localidad: "A", geom: P0 }];
      const file = [
        { id: "K", localidad: "A", _geometry: P0 },
        { id: "K", localidad: "A", _geometry: P0 },
      ];

      // Act
      const result = runObjects(db, file);

      // Assert
      expect(result.counts.exactMatchesCount).toBe(1);
      expect(result.counts.duplicateFileRowsSkipped).toBe(1);
      expect(result.discrepancyItems).toEqual([]);
      expect(result.unmatchedFileItems).toEqual([]);
    });

    it("should report two distinct DB rows with no file rows as two ONLY_IN_DB (D=2, F=0)", () => {
      // Arrange
      const db = [
        { id: "K", localidad: "A", geom: P0 },
        { id: "K", localidad: "B", geom: P5 },
      ];

      // Act
      const result = runObjects(db, []);

      // Assert
      expect(result.discrepancyItems.map((item) => [item.id, item.type])).toEqual([
        [`db-${KEY}-0`, DiscrepancyType.ONLY_IN_DB],
        [`db-${KEY}-1`, DiscrepancyType.ONLY_IN_DB],
      ]);
      expect(result.counts.onlyInDbCount).toBe(2);
      expect(result.counts.duplicateSuidCount).toBe(0);
    });

    it("should report one ONLY_IN_DB and one DUPLICATE_SUID for two identical DB rows with no file rows", () => {
      // Arrange
      const row = { id: "K", localidad: "A", geom: P0 };

      // Act
      const result = runObjects([{ ...row }, { ...row }], []);

      // Assert
      expect(result.discrepancyItems.map((item) => [item.id, item.type])).toEqual([
        [`db-${KEY}-1`, DiscrepancyType.DUPLICATE_SUID],
        [`db-${KEY}-0`, DiscrepancyType.ONLY_IN_DB],
      ]);
      expect(result.counts.onlyInDbCount).toBe(1);
      expect(result.counts.duplicateSuidCount).toBe(1);
    });

    it("should pair by geometry and flag GEOMETRY_MISMATCH with the pairing distance when geometry is compared", () => {
      // Arrange
      const db = [
        { id: "K", localidad: "a", geom: point(0, 0) },
        { id: "K", localidad: "b", geom: point(10, 0) },
      ];
      const file = [
        { id: "K", localidad: "a", _geometry: point(0.5, 0) },
        { id: "K", localidad: "b", _geometry: point(10.5, 0) },
      ];

      // Act
      const result = runObjects(db, file);

      // Assert
      expect(result.counts.geometryMismatchCount).toBe(2);
      expect(result.discrepancyItems.map((item) => item.pairing?.distance)).toEqual([0.5, 0.5]);
      expect(result.discrepancyItems.every((item) => item.pairing?.method === PairingMethod.GEOMETRY)).toBe(true);
    });

    it("should still pair by geometry but never yield GEOMETRY_MISMATCH when compareGeometry is false", () => {
      // Arrange: the nearest-geometry pairing must pair a->a' and b->b' even though geometry is ignored.
      const db = [
        { id: "K", localidad: "a", geom: point(0, 0) },
        { id: "K", localidad: "b", geom: point(10, 0) },
      ];
      const file = [
        { id: "K", localidad: "b2", _geometry: point(10.5, 0) },
        { id: "K", localidad: "a2", _geometry: point(0.5, 0) },
      ];

      // Act
      const result = runObjects(db, file, { compareGeometry: false });

      // Assert
      expect(result.counts.geometryMismatchCount).toBe(0);
      expect(result.counts.attributeMismatchCount).toBe(2);
      const byDb = Object.fromEntries(
        result.discrepancyItems.map((item) => [
          String(item.differences[0].dbValue),
          item.differences[0].shpValue,
        ])
      );
      expect(byDb).toEqual({ a: "a2", b: "b2" });
    });

    it("should count a paired row with matching attributes as a match when compareGeometry is false", () => {
      // Arrange
      const db = [
        { id: "K", localidad: "a", geom: point(0, 0) },
        { id: "K", localidad: "b", geom: point(10, 0) },
      ];
      const file = [
        { id: "K", localidad: "a", _geometry: point(0.5, 0) },
        { id: "K", localidad: "b", _geometry: point(10.5, 0) },
      ];

      // Act
      const result = runObjects(db, file, { compareGeometry: false });

      // Assert
      expect(result.counts.exactMatchesCount).toBe(2);
      expect(result.discrepancyItems).toEqual([]);
    });

    it("should give geometry precedence over attributes inside a paired group", () => {
      // Arrange
      const db = [
        { id: "K", localidad: "a", geom: point(0, 0) },
        { id: "K", localidad: "b", geom: point(10, 0) },
      ];
      const file = [
        { id: "K", localidad: "a2", _geometry: point(0.5, 0) },
        { id: "K", localidad: "b2", _geometry: point(10.5, 0) },
      ];

      // Act
      const result = runObjects(db, file);

      // Assert
      expect(result.counts.geometryMismatchCount).toBe(2);
      expect(result.counts.attributeMismatchCount).toBe(0);
      expect(result.discrepancyItems.every((item) => item.differences.length === 1)).toBe(true);
    });

    it("should pair the last remaining rows by elimination when only one lacks geometry", () => {
      // Arrange
      const db = [
        { id: "K", localidad: "a", geom: point(0, 0) },
        { id: "K", localidad: "b", geom: point(10, 0) },
      ];
      const file = [
        { id: "K", localidad: "a2", _geometry: point(0, 0) },
        { id: "K", localidad: "b2" },
      ];

      // Act
      const result = runObjects(db, file);

      // Assert
      expect(result.counts.attributeMismatchCount).toBe(2);
      expect(result.counts.duplicateSuidCount).toBe(0);
      expect(result.discrepancyItems.map((item) => item.pairing?.method).sort()).toEqual([
        PairingMethod.ELIMINATION,
        PairingMethod.GEOMETRY,
      ]);
    });

    it("should pair an equal-signature row exactly and the last remaining rows by elimination without geometry", () => {
      // Arrange
      const db = [
        { id: "K", localidad: "a" },
        { id: "K", localidad: "b" },
      ];
      const file = [
        { id: "K", localidad: "a" },
        { id: "K", localidad: "c" },
      ];

      // Act
      const result = runObjects(db, file);

      // Assert
      expect(result.counts.exactMatchesCount).toBe(1);
      expect(result.counts.attributeMismatchCount).toBe(1);
      expect(result.discrepancyItems[0].pairing?.method).toBe(PairingMethod.ELIMINATION);
    });

    it("should report every row as DUPLICATE_SUID with a note when several rows have no geometry on either side", () => {
      // Arrange
      const db = [
        { id: "K", localidad: "a" },
        { id: "K", localidad: "b" },
      ];
      const file = [
        { id: "K", localidad: "c" },
        { id: "K", localidad: "d" },
      ];

      // Act
      const result = runObjects(db, file);

      // Assert
      expect(result.counts.duplicateSuidCount).toBe(2);
      expect(result.counts.duplicateSuidFileCount).toBe(2);
      expect(result.counts.exactMatchesCount).toBe(0);
      expect(result.discrepancyItems.map((item) => item.id)).toEqual([
        `db-${KEY}-0`,
        `db-${KEY}-1`,
        `filedup:${KEY}:0`,
        `filedup:${KEY}:1`,
      ]);
      for (const item of result.discrepancyItems) {
        expect(item.type).toBe(DiscrepancyType.DUPLICATE_SUID);
        expect(item.pairing?.method).toBe(PairingMethod.NO_GEOMETRY);
        expect(item.note).toContain("geometría");
        expect(item.duplicateDetails).toEqual({ targetCount: 2, sourceCount: 2 });
      }
      expect(result.discrepancyItems[2].shpFeatureProps).toBe(file[0]);
      expect(result.unmatchedFileItems).toEqual([]);
    });
  });

  describe("collision groups on the binary DBF path", () => {
    it("should pair the Artigas case by record index rather than by position", () => {
      // Arrange: file order is swapped relative to the DB so positional pairing would be wrong.
      const db = [
        { id: "K", localidad: "ARTIGAS", geom: P0 },
        { id: "K", localidad: "N/A", geom: P0 },
      ];
      const file = [
        ["K", "ARTIGAS RURAL"],
        ["K", "ARTIGAS"],
      ];

      // Act
      const result = runDbf(db, file, [P0, P0]);

      // Assert
      expect(result.counts.exactMatchesCount).toBe(1);
      expect(result.counts.attributeMismatchCount).toBe(1);
      expect(result.counts.duplicateSuidCount).toBe(0);
      const item = result.discrepancyItems[0];
      expect(item.id).toBe(`match-${KEY}-1`);
      expect(item.fileRecordIndex).toBe(0);
      expect(item.differences).toEqual([
        { fieldName: "localidad", dbValue: "N/A", shpValue: "ARTIGAS RURAL" },
      ]);
      expect(item.shpFeatureProps).toMatchObject({ id: "K", localidad: "ARTIGAS RURAL" });
      expect(item.pairing?.method).toBe(PairingMethod.GEOMETRY);
    });

    it("should emit the leftover DBF row as an insert item carrying its record index (D=2, F=3)", () => {
      // Arrange
      const db = [
        { id: "K", localidad: "a0", geom: point(0, 0) },
        { id: "K", localidad: "a2", geom: point(20, 0) },
      ];
      const file = [
        ["K", "a0x"],
        ["K", "a1x"],
        ["K", "a2x"],
      ];

      // Act
      const result = runDbf(db, file, [point(0, 0), point(10, 0), point(20, 0)]);

      // Assert
      expect(result.counts.attributeMismatchCount).toBe(2);
      expect(result.unmatchedFileItems).toHaveLength(1);
      expect(result.unmatchedFileItems[0].id).toBe(`file-${KEY}-1`);
      expect(result.unmatchedFileItems[0].fileRecordIndex).toBe(1);
      expect(result.unmatchedFileItems[0].shpFeatureProps).toMatchObject({ localidad: "a1x" });
    });

    it("should report file duplicates with their record index when rows lack geometry", () => {
      // Arrange
      const db = [
        { id: "K", localidad: "a" },
        { id: "K", localidad: "b" },
      ];
      const file = [
        ["K", "c"],
        ["K", "d"],
      ];

      // Act
      const result = runDbf(db, file, null);

      // Assert
      const fileDuplicates = result.discrepancyItems.filter((item) => item.id.startsWith("filedup:"));
      expect(fileDuplicates.map((item) => item.fileRecordIndex)).toEqual([0, 1]);
      expect(fileDuplicates[1].shpFeatureProps).toMatchObject({ localidad: "d" });
      expect(result.counts.duplicateSuidFileCount).toBe(2);
      expect(result.counts.duplicateSuidCount).toBe(2);
    });

    it("should skip identical DBF file twins and keep the 1:1 behaviour for unique keys", () => {
      // Arrange
      const db = [
        { id: "K", localidad: "A", geom: P0 },
        { id: "U", localidad: "old", geom: P0 },
      ];
      const file = [
        ["K", "A"],
        ["K", "A"],
        ["U", "new"],
      ];

      // Act
      const result = runDbf(db, file, [P0, P0, P0]);

      // Assert
      expect(result.counts.exactMatchesCount).toBe(1);
      expect(result.counts.duplicateFileRowsSkipped).toBe(1);
      expect(result.counts.attributeMismatchCount).toBe(1);
      const unique = result.discrepancyItems[0];
      expect(unique.id).toBe(`match-${keyOf({ id: "U" }, ["id"])}-0`);
      expect(unique.pairing).toBeUndefined();
      expect(unique.fileRecordIndex).toBe(2);
    });
  });

  describe("CSV-style groups (DB geometry, file without geometry)", () => {
    it("should pair by attribute signature into two matches with no DUPLICATE_SUID", () => {
      // Arrange
      const db = [
        { id: "K", localidad: "ARTIGAS", geom: P0 },
        { id: "K", localidad: "N/A", geom: P0 },
      ];
      const file = [
        { id: "K", localidad: "N/A" },
        { id: "K", localidad: "ARTIGAS" },
      ];

      // Act
      const result = runObjects(db, file);

      // Assert
      expect(result.counts.exactMatchesCount).toBe(2);
      expect(result.counts.duplicateSuidCount).toBe(0);
      expect(result.counts.duplicateSuidFileCount).toBe(0);
      expect(result.discrepancyItems).toEqual([]);
      expect(result.unmatchedFileItems).toEqual([]);
    });

    it("should yield 1 MATCH and 1 ATTRIBUTE_MISMATCH when one file row changed its localidad", () => {
      // Arrange
      const db = [
        { id: "K", localidad: "ARTIGAS", geom: P0 },
        { id: "K", localidad: "N/A", geom: P0 },
      ];
      const file = [
        { id: "K", localidad: "ARTIGAS RURAL" },
        { id: "K", localidad: "ARTIGAS" },
      ];

      // Act
      const result = runObjects(db, file);

      // Assert
      expect(result.counts.exactMatchesCount).toBe(1);
      expect(result.counts.attributeMismatchCount).toBe(1);
      expect(result.counts.duplicateSuidCount).toBe(0);
      expect(result.counts.duplicateSuidFileCount).toBe(0);
      expect(result.discrepancyItems).toHaveLength(1);
      const item = result.discrepancyItems[0];
      expect(item.type).toBe(DiscrepancyType.ATTRIBUTE_MISMATCH);
      expect(item.differences).toEqual([
        { fieldName: "localidad", dbValue: "N/A", shpValue: "ARTIGAS RURAL" },
      ]);
    });

    it("should pair a CSV-style DBF group (no SHP reader) by attributes", () => {
      // Arrange
      const db = [
        { id: "K", localidad: "A", geom: P0 },
        { id: "K", localidad: "B", geom: P5 },
      ];
      const file = [
        ["K", "B"],
        ["K", "A"],
      ];

      // Act
      const result = runDbf(db, file, null);

      // Assert
      expect(result.counts.exactMatchesCount).toBe(2);
      expect(result.counts.duplicateSuidCount).toBe(0);
      expect(result.counts.duplicateSuidFileCount).toBe(0);
    });
  });

  describe("repeated-key note on ONLY_IN_DB", () => {
    it("should carry the repeated-key note on every ONLY_IN_DB item of a D>1 key without changing counts or duplicateDetails", () => {
      // Arrange
      const db = [
        { id: "K", localidad: "A", geom: P0 },
        { id: "K", localidad: "B", geom: P5 },
      ];

      // Act
      const result = runObjects(db, []);

      // Assert
      expect(result.discrepancyItems).toHaveLength(2);
      for (const item of result.discrepancyItems) {
        expect(item.type).toBe(DiscrepancyType.ONLY_IN_DB);
        expect(item.note).toBe("Clave repetida en DB (2 en DB / 0 en Archivo)");
        expect(item.duplicateDetails).toBeUndefined();
      }
      expect(result.counts.onlyInDbCount).toBe(2);
      expect(result.counts.duplicateSuidCount).toBe(0);
    });

    it("should report the real counts in the note when part of the group paired (D=3, F=1)", () => {
      // Arrange
      const db = [
        { id: "K", localidad: "a", geom: point(0, 0) },
        { id: "K", localidad: "b", geom: point(10, 0) },
        { id: "K", localidad: "c", geom: point(20, 0) },
      ];
      const file = [{ id: "K", localidad: "a", _geometry: point(0, 0) }];

      // Act
      const result = runObjects(db, file);

      // Assert
      const onlyInDb = ofType(result.discrepancyItems, DiscrepancyType.ONLY_IN_DB);
      expect(onlyInDb).toHaveLength(2);
      for (const item of onlyInDb) {
        expect(item.note).toBe("Clave repetida en DB (3 en DB / 1 en Archivo)");
      }
      expect(result.counts.onlyInDbCount).toBe(2);
      expect(result.counts.exactMatchesCount).toBe(1);
    });

    it("should leave the note undefined for a D=1, F=0 key", () => {
      // Act
      const result = runObjects([{ id: "K", localidad: "A", geom: P0 }], []);

      // Assert
      const item = result.discrepancyItems[0];
      expect(item.type).toBe(DiscrepancyType.ONLY_IN_DB);
      expect(item.note).toBeUndefined();
      expect(JSON.stringify(item)).not.toContain("Clave repetida");
      expect(JSON.stringify(item)).toBe(
        JSON.stringify({ id: `db-${KEY}-0`, suid: "K", type: DiscrepancyType.ONLY_IN_DB, differences: [] })
      );
    });

    it("should not put the repeated-key note on DUPLICATE_SUID items", () => {
      // Arrange
      const row = { id: "K", localidad: "A", geom: P0 };

      // Act
      const result = runObjects([{ ...row }, { ...row }], []);

      // Assert
      const duplicate = ofType(result.discrepancyItems, DiscrepancyType.DUPLICATE_SUID)[0];
      expect(duplicate.note).not.toContain("Clave repetida");
    });
  });

  describe("progress emission", () => {
    function bulkRows(prefix: string, count: number): Rec[] {
      return Array.from({ length: count }, (_unused, index) => ({
        id: prefix,
        localidad: `${prefix}-${index}`,
      }));
    }

    it("should emit once per 10,000-row milestone change even when one key jumps several milestones", () => {
      // Arrange
      const mapping = baseMapping();
      const dbSuidMap = new Map<string, Rec[]>([
        ["k1", bulkRows("k1", 9_999)],
        ["k2", bulkRows("k2", 2)],
        ["k3", bulkRows("k3", 25_000)],
        ["k4", bulkRows("k4", 1)],
        ["k5", bulkRows("k5", 5_000)],
      ]);
      const emitted: Array<[string, number, number]> = [];

      // Act
      comparator.compareMatchedRecords({
        ...baseParams(mapping),
        dbSuidMap,
        emit: (phase, current, total) => emitted.push([phase, current, total]),
      });

      // Assert
      expect(emitted.map(([, current]) => current)).toEqual([10_001, 35_001, 40_002]);
      expect(emitted.every(([, , total]) => total === 5)).toBe(true);
      expect(emitted.every(([phase]) => typeof phase === "string" && phase.length > 0)).toBe(true);
    });

    it("should not emit while the processed row count stays below the first milestone", () => {
      // Arrange
      const mapping = baseMapping();
      const emitted: number[] = [];

      // Act
      comparator.compareMatchedRecords({
        ...baseParams(mapping),
        dbSuidMap: new Map<string, Rec[]>([["k1", bulkRows("k1", 9_999)]]),
        emit: (_phase, current) => emitted.push(current),
      });

      // Assert
      expect(emitted).toEqual([]);
    });

    it("should emit exactly at a milestone boundary and not again within the same milestone", () => {
      // Arrange
      const mapping = baseMapping();
      const emitted: number[] = [];

      // Act
      comparator.compareMatchedRecords({
        ...baseParams(mapping),
        dbSuidMap: new Map<string, Rec[]>([
          ["k1", bulkRows("k1", 10_000)],
          ["k2", bulkRows("k2", 3)],
          ["k3", bulkRows("k3", 3)],
        ]),
        emit: (_phase, current) => emitted.push(current),
      });

      // Assert
      expect(emitted).toEqual([10_000]);
    });
  });

  describe("coordinate transform on the file geometry read (AC10)", () => {
    it("should read file geometry through the transform and pair using the transformed coordinates", () => {
      // Arrange: raw file coordinates would pair d0-f0 and d1-f1 (distance 0); after the +100 shift
      // the closest edge is d1-f0 (distance 0) and d0 is left with f1 (distance 200).
      const mapping = baseMapping({ compareGeometry: false });
      const reader = new BinaryDbfReader(
        makeDbf(["id", "localidad"], [["K", "f0"], ["K", "f1"]])
      );
      const rawGeometries = [point(0, 0), point(100, 0)];
      const receivedTransforms: unknown[] = [];
      const shift = (coordinate: [number, number]): [number, number] => [
        coordinate[0] + 100,
        coordinate[1],
      ];
      const shpReader = {
        readGeometry: (
          recordIndex: number,
          transform: ((coordinate: [number, number]) => [number, number]) | null
        ) => {
          receivedTransforms.push(transform);
          const raw = rawGeometries[recordIndex] as { type: string; coordinates: [number, number] };
          return transform ? { type: "Point", coordinates: transform(raw.coordinates) } : raw;
        },
      } as unknown as BinaryShpReader;
      const dbfCompareFields = new Map<string, DbfFieldDescriptor>();
      const descriptor = reader.header.fields.find((field) => field.name === "localidad");
      if (descriptor) dbfCompareFields.set("localidad", descriptor);
      const db = [
        { id: "K", localidad: "d0", geom: point(0, 0) },
        { id: "K", localidad: "d1", geom: point(100, 0) },
      ];

      // Act
      const result = comparator.compareMatchedRecords({
        ...baseParams(mapping),
        dbSuidMap: groupBy(db, mapping.suidColumns),
        binaryFileSuidMap: new FileDatasetIndexer(resolver).indexBinaryDbf(reader, ["id"]).suidMap,
        dbfReader: reader,
        shpReader,
        transformCoordinate: shift,
        dbfCompareFields,
      });

      // Assert
      expect(receivedTransforms.length).toBeGreaterThan(0);
      expect(receivedTransforms.every((transform) => transform === shift)).toBe(true);
      expect(result.counts.attributeMismatchCount).toBe(2);
      const byDb = Object.fromEntries(
        result.discrepancyItems.map((item) => [item.id, item.fileRecordIndex])
      );
      expect(byDb).toEqual({ [`match-${KEY}-0`]: 1, [`match-${KEY}-1`]: 0 });
      const distances = Object.fromEntries(
        result.discrepancyItems.map((item) => [item.id, item.pairing?.distance])
      );
      expect(distances).toEqual({ [`match-${KEY}-0`]: 200, [`match-${KEY}-1`]: 0 });
    });

    it("should pair on the raw coordinates when no transform is configured", () => {
      // Arrange
      const mapping = baseMapping({ compareGeometry: false });
      const reader = new BinaryDbfReader(
        makeDbf(["id", "localidad"], [["K", "f0"], ["K", "f1"]])
      );
      const rawGeometries = [point(0, 0), point(100, 0)];
      const receivedTransforms: unknown[] = [];
      const shpReader = {
        readGeometry: (recordIndex: number, transform: unknown) => {
          receivedTransforms.push(transform);
          return rawGeometries[recordIndex];
        },
      } as unknown as BinaryShpReader;
      const dbfCompareFields = new Map<string, DbfFieldDescriptor>();
      const descriptor = reader.header.fields.find((field) => field.name === "localidad");
      if (descriptor) dbfCompareFields.set("localidad", descriptor);
      const db = [
        { id: "K", localidad: "d0", geom: point(0, 0) },
        { id: "K", localidad: "d1", geom: point(100, 0) },
      ];

      // Act
      const result = comparator.compareMatchedRecords({
        ...baseParams(mapping),
        dbSuidMap: groupBy(db, mapping.suidColumns),
        binaryFileSuidMap: new FileDatasetIndexer(resolver).indexBinaryDbf(reader, ["id"]).suidMap,
        dbfReader: reader,
        shpReader,
        dbfCompareFields,
      });

      // Assert
      expect(receivedTransforms.every((transform) => transform === null)).toBe(true);
      const byDb = Object.fromEntries(
        result.discrepancyItems.map((item) => [item.id, item.fileRecordIndex])
      );
      expect(byDb).toEqual({ [`match-${KEY}-0`]: 0, [`match-${KEY}-1`]: 1 });
    });
  });

  describe("reconciliation on a large mixed fixture", () => {
    function buildFixture() {
      const db: Rec[] = [];
      const file: Rec[] = [];
      for (let keyNumber = 0; keyNumber < 180; keyNumber++) {
        const id = `K${keyNumber}`;
        const dbRow = (localidad: string, geom?: unknown) => db.push({ id, localidad, geom });
        const fileRow = (localidad: string, geom?: unknown) =>
          file.push({ id, localidad, _geometry: geom });
        const at = (offset: number) => point(keyNumber * 100 + offset, 0);
        switch (keyNumber % 10) {
          case 0:
            dbRow("a", at(0));
            fileRow("a", at(0));
            break;
          case 1:
            dbRow("a", at(0));
            fileRow("b", at(0));
            break;
          case 2:
            dbRow("a", at(0));
            fileRow("a", at(5));
            break;
          case 3:
            dbRow("ok", at(0));
            dbRow("N/A", at(0));
            fileRow("ARTIGAS RURAL", at(0));
            fileRow("ok", at(0));
            break;
          case 4:
            dbRow("a", at(0));
            dbRow("b", at(10));
            dbRow("c", at(20));
            fileRow("ax", at(0));
            fileRow("cx", at(20));
            break;
          case 5:
            dbRow("a", at(0));
            dbRow("c", at(20));
            fileRow("ax", at(0));
            fileRow("bx", at(10));
            fileRow("cx", at(20));
            break;
          case 6:
            dbRow("a", at(0));
            dbRow("b", at(10));
            break;
          case 7:
            dbRow("a", at(0));
            dbRow("a", at(0));
            fileRow("a", at(0));
            fileRow("a", at(0));
            fileRow("a", at(0));
            break;
          case 8:
            dbRow("a");
            dbRow("b");
            fileRow("c");
            fileRow("d");
            fileRow("e");
            break;
          default:
            dbRow("a", at(0));
            dbRow("a", at(0));
            break;
        }
      }
      db.push({ id: null, localidad: "null-db" }, { id: "", localidad: "empty-db" });
      file.push({ id: "", localidad: "null-file" });
      file.push({ id: "ONLY_FILE", localidad: "x" }, { id: "ONLY_FILE", localidad: "y" });
      return { db, file };
    }

    it("should reconcile every non-null DB row and every non-null file row exactly once", () => {
      // Arrange
      const { db, file } = buildFixture();
      const mapping = baseMapping();
      const dbMap = groupBy(db, mapping.suidColumns);
      const indexedDbRows = [...dbMap.values()].reduce((sum, rows) => sum + rows.length, 0);
      const fileMap = groupBy(file, mapping.suidColumns);
      let fileRowsInDbKeys = 0;
      fileMap.forEach((rows, key) => {
        if (dbMap.has(key)) fileRowsInDbKeys += rows.length;
      });

      // Act
      const result = runObjects(db, file);

      // Assert
      const { counts } = result;
      expect(counts.exactMatchesCount).toBeGreaterThan(0);
      expect(counts.attributeMismatchCount).toBeGreaterThan(0);
      expect(counts.geometryMismatchCount).toBeGreaterThan(0);
      expect(counts.onlyInDbCount).toBeGreaterThan(0);
      expect(counts.duplicateSuidCount).toBeGreaterThan(0);
      expect(counts.onlyInFileCount).toBeGreaterThan(0);
      expect(counts.duplicateSuidFileCount).toBeGreaterThan(0);
      expect(counts.duplicateFileRowsSkipped).toBeGreaterThan(0);
      const pairedCount =
        counts.exactMatchesCount + counts.attributeMismatchCount + counts.geometryMismatchCount;
      expect(pairedCount + counts.onlyInDbCount + counts.duplicateSuidCount).toBe(indexedDbRows);
      expect(
        pairedCount +
          counts.onlyInFileCount +
          counts.duplicateSuidFileCount +
          counts.duplicateFileRowsSkipped
      ).toBe(fileRowsInDbKeys);
      expect(result.processedSuids.size).toBe(dbMap.size);
    });

    it("should emit unique item ids that agree with the counters", () => {
      // Arrange
      const { db, file } = buildFixture();

      // Act
      const result = runObjects(db, file);

      // Assert
      const ids = allIds(result);
      expect(new Set(ids).size).toBe(ids.length);
      const duplicates = ofType(result.discrepancyItems, DiscrepancyType.DUPLICATE_SUID);
      expect(duplicates).toHaveLength(
        result.counts.duplicateSuidCount + result.counts.duplicateSuidFileCount
      );
      expect(duplicates.filter((item) => item.id.startsWith("filedup:"))).toHaveLength(
        result.counts.duplicateSuidFileCount
      );
      expect(ofType(result.discrepancyItems, DiscrepancyType.ONLY_IN_DB)).toHaveLength(
        result.counts.onlyInDbCount
      );
      expect(result.unmatchedFileItems).toHaveLength(result.counts.onlyInFileCount);
      expect(ofType(result.unmatchedFileItems, DiscrepancyType.ONLY_IN_SHP)).toHaveLength(
        result.counts.onlyInFileCount
      );
    });

    it("should produce identical results when the input row order is reversed within each key", () => {
      // Arrange
      const { db, file } = buildFixture();

      // Act
      const forward = runObjects(db, file);
      const reversed = runObjects([...db].reverse(), [...file].reverse());

      // Assert
      expect(reversed.counts).toEqual(forward.counts);
    });
  });
});
