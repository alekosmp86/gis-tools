import { describe, it, expect } from "vitest";
import { UnmatchedFileFeaturesCollector } from "@/core/workers/comparison/UnmatchedFileFeaturesCollector";
import { SuidKeyResolver } from "@/core/workers/comparison/SuidKeyResolver";
import { DiscrepancyType } from "@/core/types/comparison";
import type { SuidKeyOptions } from "@/core/workers/comparison/SuidKeyResolver";
import type { BinaryDbfReader } from "@/core/binary/BinaryDbfReader";
import type { BinaryShpReader } from "@/core/binary/BinaryShpReader";

type Rec = Record<string, unknown>;

const collector = new UnmatchedFileFeaturesCollector(new SuidKeyResolver());

function runObject(
  objectFileSuidMap: Map<string, Rec[]>,
  opts: {
    processed?: string[];
    signatureColumns?: string[];
    keyOptions?: SuidKeyOptions;
  } = {}
) {
  return collector.collectUnmatchedFileFeatures({
    processedSuids: new Set(opts.processed ?? []),
    binaryFileSuidMap: new Map(),
    objectFileSuidMap,
    targetFileSuidCols: ["id"],
    signatureColumns: opts.signatureColumns,
    keyOptions: opts.keyOptions,
    dbfReader: null,
    shpReader: null,
    transformCoordinate: null,
  });
}

function stubDbf(records: Rec[]): BinaryDbfReader {
  return { readRecord: (index: number) => records[index] ?? null } as unknown as BinaryDbfReader;
}

function runDbf(
  map: Map<string, number[]>,
  records: Rec[],
  opts: { processed?: string[]; shp?: BinaryShpReader | null } = {}
) {
  return collector.collectUnmatchedFileFeatures({
    processedSuids: new Set(opts.processed ?? []),
    binaryFileSuidMap: map,
    objectFileSuidMap: new Map(),
    targetFileSuidCols: ["id"],
    signatureColumns: ["name"],
    dbfReader: stubDbf(records),
    shpReader: opts.shp ?? null,
    transformCoordinate: null,
  });
}

describe("UnmatchedFileFeaturesCollector", () => {
  describe("object (CSV) path", () => {
    it("should return empty result when map is empty", () => {
      // Act
      const result = runObject(new Map());

      // Assert
      expect(result).toEqual({ insertItems: [], duplicateItems: [], duplicateFileRowsSkipped: 0 });
    });

    it("should emit one ONLY_IN_SHP when key has a single occurrence", () => {
      // Arrange
      const map = new Map([["a", [{ id: "A", name: "n" }]]]);

      // Act
      const result = runObject(map);

      // Assert
      expect(result.insertItems).toHaveLength(1);
      expect(result.insertItems[0].type).toBe(DiscrepancyType.ONLY_IN_SHP);
      expect(result.insertItems[0].suid).toBe("A");
      expect(result.duplicateItems).toHaveLength(0);
      expect(result.duplicateFileRowsSkipped).toBe(0);
    });

    it.each([2, 3])(
      "should collapse %i identical rows into one insert and count skipped rows",
      (count) => {
        // Arrange
        const rows = Array.from({ length: count }, () => ({ id: "A", name: "same" }));
        const map = new Map([["a", rows]]);

        // Act
        const result = runObject(map, { signatureColumns: ["name"] });

        // Assert
        expect(result.insertItems).toHaveLength(1);
        expect(result.insertItems[0].shpFeatureProps).toBe(rows[0]);
        expect(result.duplicateItems).toHaveLength(0);
        expect(result.duplicateFileRowsSkipped).toBe(count - 1);
      }
    );

    it.each([2, 3])(
      "should flag %i same-key same-attribute rows with different geometry as ambiguous duplicates",
      (count) => {
        // Arrange
        const rows = Array.from({ length: count }, (_, i) => ({
          id: "A",
          name: "n",
          _geometry: { type: "Point", coordinates: [i, i] },
        }));

        // Act
        const result = runObject(new Map([["a", rows]]), { signatureColumns: ["name"] });

        // Assert
        expect(result.insertItems).toHaveLength(0);
        expect(result.duplicateFileRowsSkipped).toBe(0);
        expect(result.duplicateItems).toHaveLength(count);
        result.duplicateItems.forEach((item, index) => {
          expect(item.type).toBe(DiscrepancyType.DUPLICATE_SUID);
          expect(item.duplicateDetails).toEqual({ targetCount: 0, sourceCount: count });
          expect(item.id).toBe(`filedup:a:${index}`);
        });
      }
    );

    it.each([2, 3])(
      "should collapse %i same-key same-attribute rows with identical geometry",
      (count) => {
        // Arrange
        const rows = Array.from({ length: count }, () => ({
          id: "A",
          name: "n",
          _geometry: { type: "Point", coordinates: [1, 1] },
        }));

        // Act
        const result = runObject(new Map([["a", rows]]), { signatureColumns: ["name"] });

        // Assert
        expect(result.insertItems).toHaveLength(1);
        expect(result.duplicateItems).toHaveLength(0);
        expect(result.duplicateFileRowsSkipped).toBe(count - 1);
      }
    );

    it("should emit the first record geometry on the DUPLICATE_SUID item of a record lacking _geometry", () => {
      // Arrange
      const geometry = { type: "Point", coordinates: [3, 3] };
      const rows = [
        { id: "A", name: "n", _geometry: geometry },
        { id: "A", name: "n" },
      ];

      // Act
      const result = runObject(new Map([["a", rows]]), { signatureColumns: ["name"] });

      // Assert
      expect(result.insertItems).toHaveLength(0);
      expect(result.duplicateItems).toHaveLength(2);
      expect(result.duplicateItems[0].shpGeometry).toBe(geometry);
      expect(result.duplicateItems[1].shpGeometry).toBe(geometry);
    });

    it.each([
      ["geometry first", true],
      ["geometry last", false],
    ])(
      "should flag a row with geometry and an otherwise identical row without as ambiguous (%s)",
      (_label, geometryFirst) => {
        // Arrange
        const withGeometry = { id: "A", name: "n", _geometry: { type: "Point", coordinates: [1, 1] } };
        const withoutGeometry = { id: "A", name: "n" };
        const rows = geometryFirst ? [withGeometry, withoutGeometry] : [withoutGeometry, withGeometry];

        // Act
        const result = runObject(new Map([["a", rows]]), { signatureColumns: ["name"] });

        // Assert
        expect(result.insertItems).toHaveLength(0);
        expect(result.duplicateFileRowsSkipped).toBe(0);
        expect(result.duplicateItems).toHaveLength(2);
        result.duplicateItems.forEach((item) => {
          expect(item.type).toBe(DiscrepancyType.DUPLICATE_SUID);
          expect(item.duplicateDetails).toEqual({ targetCount: 0, sourceCount: 2 });
        });
      }
    );

    it("should collapse two otherwise identical rows that both lack geometry", () => {
      // Arrange
      const rows = [{ id: "A", name: "n" }, { id: "A", name: "n" }];

      // Act
      const result = runObject(new Map([["a", rows]]), { signatureColumns: ["name"] });

      // Assert
      expect(result.insertItems).toHaveLength(1);
      expect(result.insertItems[0].shpGeometry).toBeUndefined();
      expect(result.duplicateItems).toHaveLength(0);
      expect(result.duplicateFileRowsSkipped).toBe(1);
    });

    it.each([[[]], [["id"]]])(
      "should flag rows differing in an unmapped property as ambiguous when compared columns are %j",
      (signatureColumns) => {
        // Arrange
        const rows = [{ id: "A", extra: "1" }, { id: "A", extra: "2" }];

        // Act
        const result = runObject(new Map([["a", rows]]), { signatureColumns });

        // Assert
        expect(result.insertItems).toHaveLength(0);
        expect(result.duplicateItems).toHaveLength(2);
        expect(result.duplicateItems[0].type).toBe(DiscrepancyType.DUPLICATE_SUID);
      }
    );

    it.each([[[]], [["id"]]])(
      "should collapse fully identical rows when compared columns are %j",
      (signatureColumns) => {
        // Arrange
        const rows = [1, 2, 3].map(() => ({ id: "A", extra: "1" }));

        // Act
        const result = runObject(new Map([["a", rows]]), { signatureColumns });

        // Assert
        expect(result.insertItems).toHaveLength(1);
        expect(result.duplicateItems).toHaveLength(0);
        expect(result.duplicateFileRowsSkipped).toBe(2);
      }
    );

    it("should collapse placeholder-variant SUID cells when treatPlaceholdersAsEmpty is on", () => {
      // Arrange
      const rows = ["N/A", "", "n/a", "N/a"].map((id) => ({ id, name: "n" }));

      // Act
      const result = runObject(new Map([["", rows]]), {
        signatureColumns: ["name"],
        keyOptions: { treatPlaceholdersAsEmpty: true },
      });

      // Assert
      expect(result.insertItems).toHaveLength(1);
      expect(result.duplicateItems).toHaveLength(0);
      expect(result.duplicateFileRowsSkipped).toBe(3);
    });

    it("should flag placeholder-variant SUID rows as ambiguous when treatPlaceholdersAsEmpty is off", () => {
      // Arrange
      const rows = ["N/A", ""].map((id) => ({ id, name: "n" }));

      // Act
      const result = runObject(new Map([["", rows]]), { signatureColumns: ["name"] });

      // Assert
      expect(result.insertItems).toHaveLength(0);
      expect(result.duplicateItems).toHaveLength(2);
    });

    it("should not collide insert id for key 'dup-x' with duplicate ids of key 'x'", () => {
      // Arrange
      const map = new Map<string, Rec[]>([
        ["x", [{ id: "x", name: "1" }, { id: "x", name: "2" }]],
        ["dup-x", [{ id: "dup-x", name: "1" }]],
      ]);

      // Act
      const result = runObject(map, { signatureColumns: ["name"] });

      // Assert
      const ids = [...result.insertItems, ...result.duplicateItems].map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(result.insertItems[0].id).toBe("file-dup-x-0");
      expect(result.duplicateItems.map((i) => i.id)).toEqual(["filedup:x:0", "filedup:x:1"]);
    });

    it("should treat values differing only by case of column name and quoting as identical", () => {
      // Arrange
      const map = new Map([["a", [{ id: "A", NAME: ' "x.0" ' }, { id: "A", name: "x" }]]]);

      // Act
      const result = runObject(map, { signatureColumns: ["name"] });

      // Assert
      expect(result.insertItems).toHaveLength(1);
      expect(result.duplicateFileRowsSkipped).toBe(1);
    });

    it.each([2, 3])(
      "should emit %i DUPLICATE_SUID items and zero inserts when contents differ",
      (count) => {
        // Arrange
        const rows = Array.from({ length: count }, (_, i) => ({ id: "A", name: `v${i}` }));
        const map = new Map([["a", rows]]);

        // Act
        const result = runObject(map, { signatureColumns: ["name"] });

        // Assert
        expect(result.insertItems).toHaveLength(0);
        expect(result.duplicateFileRowsSkipped).toBe(0);
        expect(result.duplicateItems).toHaveLength(count);
        result.duplicateItems.forEach((item) => {
          expect(item.type).toBe(DiscrepancyType.DUPLICATE_SUID);
          expect(item.duplicateDetails).toEqual({ targetCount: 0, sourceCount: count });
          expect(item.note).toBe(`SUID Duplicado (0 en DB / ${count} en Archivo)`);
        });
      }
    );

    it("should flag ambiguity when only one of three rows differs", () => {
      // Arrange
      const map = new Map([
        ["a", [{ id: "A", name: "x" }, { id: "A", name: "x" }, { id: "A", name: "y" }]],
      ]);

      // Act
      const result = runObject(map, { signatureColumns: ["name"] });

      // Assert
      expect(result.insertItems).toHaveLength(0);
      expect(result.duplicateItems).toHaveLength(3);
    });

    it("should skip keys already in processedSuids", () => {
      // Arrange
      const map = new Map([
        ["a", [{ id: "A", name: "x" }, { id: "A", name: "y" }]],
        ["b", [{ id: "B", name: "x" }]],
      ]);

      // Act
      const result = runObject(map, { processed: ["a"], signatureColumns: ["name"] });

      // Assert
      expect(result.duplicateItems).toHaveLength(0);
      expect(result.insertItems.map((i) => i.suid)).toEqual(["B"]);
    });

    it("should handle a mix of unique, identical and ambiguous keys", () => {
      // Arrange
      const map = new Map([
        ["u", [{ id: "U", name: "1" }]],
        ["i", [{ id: "I", name: "1" }, { id: "I", name: "1" }, { id: "I", name: "1" }]],
        ["d", [{ id: "D", name: "1" }, { id: "D", name: "2" }]],
      ]);

      // Act
      const result = runObject(map, { signatureColumns: ["name"] });

      // Assert
      expect(result.insertItems.map((i) => i.suid).sort()).toEqual(["I", "U"]);
      expect(result.duplicateItems).toHaveLength(2);
      expect(result.duplicateFileRowsSkipped).toBe(2);
    });
  });

  describe("DBF path", () => {
    it("should collapse identical DBF rows and keep first record index", () => {
      // Arrange
      const records = [{ id: "A", name: "x" }, { id: "A", name: "x" }, { id: "A", name: "x" }];
      const map = new Map([["a", [0, 1, 2]]]);

      // Act
      const result = runDbf(map, records);

      // Assert
      expect(result.insertItems).toHaveLength(1);
      expect(result.insertItems[0].fileRecordIndex).toBe(0);
      expect(result.duplicateFileRowsSkipped).toBe(2);
      expect(result.duplicateItems).toHaveLength(0);
    });

    it("should emit DUPLICATE_SUID items with record indices when DBF rows differ", () => {
      // Arrange
      const records = [{ id: "A", name: "x" }, { id: "B", name: "q" }, { id: "A", name: "y" }];
      const map = new Map([["a", [0, 2]]]);

      // Act
      const result = runDbf(map, records);

      // Assert
      expect(result.insertItems).toHaveLength(0);
      expect(result.duplicateItems.map((i) => i.fileRecordIndex)).toEqual([0, 2]);
      expect(result.duplicateItems[0].duplicateDetails).toEqual({ targetCount: 0, sourceCount: 2 });
    });

    it("should flag DBF rows with same attributes but different shp geometry as duplicates", () => {
      // Arrange
      const shp = {
        readGeometry: (index: number) => ({ type: "Point", coordinates: [index, index] }),
      } as unknown as BinaryShpReader;
      const records = [{ id: "A", name: "x" }, { id: "A", name: "x" }];

      // Act
      const result = runDbf(new Map([["a", [0, 1]]]), records, { shp });

      // Assert
      expect(result.insertItems).toHaveLength(0);
      expect(result.duplicateItems).toHaveLength(2);
      expect(result.duplicateItems[0].id).toBe("filedup:a:0");
    });

    it("should collapse DBF rows with same attributes and same shp geometry", () => {
      // Arrange
      const shp = {
        readGeometry: () => ({ type: "Point", coordinates: [1, 1] }),
      } as unknown as BinaryShpReader;
      const records = [{ id: "A", name: "x" }, { id: "A", name: "x" }, { id: "A", name: "x" }];

      // Act
      const result = runDbf(new Map([["a", [0, 1, 2]]]), records, { shp });

      // Assert
      expect(result.insertItems).toHaveLength(1);
      expect(result.duplicateFileRowsSkipped).toBe(2);
      expect(result.duplicateItems).toHaveLength(0);
    });

    it("should emit single ONLY_IN_SHP using shp geometry and skip processed keys", () => {
      // Arrange
      const geom = { type: "Point", coordinates: [1, 2] };
      const shp = { readGeometry: () => geom } as unknown as BinaryShpReader;
      const records = [{ id: "A", name: "x" }, { id: "B", name: "y" }];
      const map = new Map([["a", [0]], ["b", [1]]]);

      // Act
      const result = runDbf(map, records, { processed: ["b"], shp });

      // Assert
      expect(result.insertItems).toHaveLength(1);
      expect(result.insertItems[0].shpGeometry).toBe(geom);
      expect(result.insertItems[0].suid).toBe("A");
    });
  });
});
