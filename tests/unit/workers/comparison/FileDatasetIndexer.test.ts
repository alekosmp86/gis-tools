import { describe, it, expect, vi } from "vitest";
import { FileDatasetIndexer } from "@/core/workers/comparison/FileDatasetIndexer";
import type { SerializableFileDataset } from "@/core/types/workerMessages";

describe("FileDatasetIndexer", () => {
  const indexer = new FileDatasetIndexer();

  describe("indexObjectDataset", () => {
    it("should index features by composite SUID key into a hash map", () => {
      // Arrange
      const dataset: SerializableFileDataset = {
        fileName: "test.csv",
        fileSize: 1024,
        featureCount: 2,
        attributes: ["id", "nombre"],
        recordsObject: {
          "0": { id: "100", nombre: "PUNTA DEL ESTE" },
          "1": { id: "101", nombre: "LA BARRA" },
        },
        geojson: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { id: "100", nombre: "PUNTA DEL ESTE" },
              geometry: { type: "Point", coordinates: [-54.9, -34.9] },
            },
            {
              type: "Feature",
              properties: { id: "101", nombre: "LA BARRA" },
              geometry: { type: "Point", coordinates: [-54.8, -34.9] },
            },
          ],
        },
      };

      // Act
      const result = indexer.indexObjectDataset(dataset, ["id"]);

      // Assert
      expect(result.totalRecords).toBe(2);
      expect(result.suidMap.has("100")).toBe(true);
      expect(result.suidMap.has("101")).toBe(true);
      expect(result.nullRecords).toHaveLength(0);
    });

    it("should classify records with empty SUID as nullRecords", () => {
      // Arrange
      const dataset: SerializableFileDataset = {
        fileName: "test.csv",
        fileSize: 1024,
        featureCount: 1,
        attributes: ["id", "nombre"],
        recordsObject: {
          "0": { id: "", nombre: "ANONYMOUS" },
        },
      };

      // Act
      const result = indexer.indexObjectDataset(dataset, ["id"]);

      // Assert
      expect(result.nullRecords).toHaveLength(1);
      expect(result.suidMap.size).toBe(0);
    });

    it("should group duplicate SUID records under the same key array", () => {
      // Arrange
      const dataset: SerializableFileDataset = {
        fileName: "test.csv",
        fileSize: 1024,
        featureCount: 2,
        attributes: ["code", "desc"],
        recordsObject: {
          "0": { code: "DUP_01", desc: "First Occurrence" },
          "1": { code: "DUP_01", desc: "Second Occurrence" },
        },
      };

      // Act
      const result = indexer.indexObjectDataset(dataset, ["code"]);

      // Assert
      expect(result.suidMap.has("dup_01")).toBe(true);
      expect(result.suidMap.get("dup_01")).toHaveLength(2);
    });

    it("should keep all-placeholder SUID as a real key when option is omitted", () => {
      // Arrange
      const dataset: SerializableFileDataset = {
        fileName: "t.csv",
        fileSize: 1,
        featureCount: 1,
        attributes: ["id"],
        recordsObject: { "0": { id: "N/A" } },
      };

      // Act
      const result = indexer.indexObjectDataset(dataset, ["id"]);

      // Assert
      expect(result.nullRecords).toHaveLength(0);
      expect(result.suidMap.has("n/a")).toBe(true);
    });

    it("should classify all-placeholder SUID as null record when option is true", () => {
      // Arrange
      const dataset: SerializableFileDataset = {
        fileName: "t.csv",
        fileSize: 1,
        featureCount: 2,
        attributes: ["id"],
        recordsObject: { "0": { id: "N/A" }, "1": { id: "S/N" } },
      };

      // Act
      const result = indexer.indexObjectDataset(dataset, ["id"], {
        treatPlaceholdersAsEmpty: true,
      });

      // Assert
      expect(result.nullRecords).toHaveLength(2);
      expect(result.suidMap.size).toBe(0);
    });
  });

  describe("indexBinaryDbf", () => {
    const stubDbf = (values: string[]) =>
      ({
        header: { recordCount: values.length, fields: [{ name: "ID" }] },
        readFieldValue: (index: number) => values[index],
      }) as unknown as import("@/core/binary/BinaryDbfReader").BinaryDbfReader;

    it("should keep placeholder as key when option is omitted", () => {
      // Act
      const result = indexer.indexBinaryDbf(stubDbf(["N/A", "X1"]), ["id"]);

      // Assert
      expect(result.nullRecordIndices).toEqual([]);
      expect(result.suidMap.get("n/a")).toEqual([0]);
    });

    it("should send placeholder SUID rows to nullRecordIndices when option is true", () => {
      // Act
      const result = indexer.indexBinaryDbf(stubDbf(["N/A", "X1", "", "sn"]), ["id"], {
        treatPlaceholdersAsEmpty: true,
      });

      // Assert
      expect(result.nullRecordIndices).toEqual([0, 2, 3]);
      expect(Array.from(result.suidMap.keys())).toEqual(["x1"]);
      expect(result.totalRecords).toBe(4);
    });
  });

  describe("degenerate geometries (DG-2, DG-4)", () => {
    const COLLAPSED = { type: "LineString", coordinates: [[6.6e5, 6.15e6], [6.6e5 + 3.5e-10, 6.15e6]] };
    const GOOD = { type: "LineString", coordinates: [[0, 0], [10, 10]] };

    const objectDataset = (rows: Array<{ id: string; geometry: unknown }>): SerializableFileDataset => {
      const recordsObject: Record<string, Record<string, unknown>> = {};
      rows.forEach((row, index) => {
        recordsObject[String(index)] = { id: row.id };
      });
      return {
        fileName: "t.csv",
        fileSize: 1,
        featureCount: rows.length,
        attributes: ["id"],
        recordsObject,
        geojson: {
          type: "FeatureCollection",
          features: rows.map((row) => ({ type: "Feature", properties: { id: row.id }, geometry: row.geometry })),
        },
      } as unknown as SerializableFileDataset;
    };

    describe("indexObjectDataset", () => {
      it("should leave a degenerate row out of the key map and the null records, and collect it with its 1-based row number and key", () => {
        const result = indexer.indexObjectDataset(
          objectDataset([
            { id: "A", geometry: GOOD },
            { id: "BAD", geometry: COLLAPSED },
            { id: "B", geometry: GOOD },
          ]),
          ["id"]
        );

        expect(Array.from(result.suidMap.keys())).toEqual(["a", "b"]);
        expect(result.suidMap.has("bad")).toBe(false);
        expect(result.nullRecords).toHaveLength(0);
        expect(result.degenerate.count).toBe(1);
        expect(result.degenerate.sample).toEqual([{ rowNumber: 2, suid: "BAD" }]);
      });

      it("should keep totalRecords as the raw number of file rows", () => {
        const result = indexer.indexObjectDataset(objectDataset([{ id: "A", geometry: COLLAPSED }, { id: "B", geometry: GOOD }]), ["id"]);

        expect(result.totalRecords).toBe(2);
      });

      it("should count a degenerate row with an empty key as degenerate, not as a null record", () => {
        const result = indexer.indexObjectDataset(objectDataset([{ id: "", geometry: COLLAPSED }]), ["id"]);

        expect(result.degenerate.count).toBe(1);
        expect(result.nullRecords).toHaveLength(0);
        expect(result.degenerate.sample).toEqual([{ rowNumber: 1, suid: "" }]);
      });

      it("should not let a degenerate row join the key group of a valid row", () => {
        const result = indexer.indexObjectDataset(objectDataset([{ id: "A", geometry: COLLAPSED }, { id: "A", geometry: GOOD }]), ["id"]);

        expect(result.suidMap.get("a")).toHaveLength(1);
        expect(result.degenerate.count).toBe(1);
      });

      it("should return an empty collector for a file with no degenerate rows and the same map as before", () => {
        const result = indexer.indexObjectDataset(objectDataset([{ id: "A", geometry: GOOD }, { id: "B", geometry: null }]), ["id"]);

        expect(result.degenerate.count).toBe(0);
        expect(result.degenerate.sample).toEqual([]);
        expect(Array.from(result.suidMap.keys())).toEqual(["a", "b"]);
      });

      it("should read the geometry of a record without a geojson feature from the record itself", () => {
        const dataset = {
          fileName: "t.csv",
          fileSize: 1,
          featureCount: 1,
          attributes: ["id"],
          recordsObject: { "0": { id: "A", _geometry: COLLAPSED } },
        } as unknown as SerializableFileDataset;

        const result = indexer.indexObjectDataset(dataset, ["id"]);

        expect(result.degenerate.count).toBe(1);
        expect(result.suidMap.size).toBe(0);
      });
    });

    describe("indexBinaryDbf", () => {
      const stubDbf = (values: string[]) =>
        ({
          header: { recordCount: values.length, fields: [{ name: "ID" }] },
          readFieldValue: (index: number) => values[index],
          readRecord: (index: number) => ({ ID: values[index] }),
        }) as unknown as import("@/core/binary/BinaryDbfReader").BinaryDbfReader;

      const stubShp = (geometries: unknown[]) => {
        const readGeometry = vi.fn((index: number) => geometries[index] ?? null);
        return { reader: { readGeometry } as unknown as import("@/core/binary/BinaryShpReader").BinaryShpReader, readGeometry };
      };

      it("should leave a degenerate record out of the index and collect its 1-based row number and key", () => {
        const { reader } = stubShp([GOOD, COLLAPSED, GOOD]);

        const result = indexer.indexBinaryDbf(stubDbf(["A", "BAD", "B"]), ["id"], undefined, reader);

        expect(Array.from(result.suidMap.entries())).toEqual([
          ["a", [0]],
          ["b", [2]],
        ]);
        expect(result.nullRecordIndices).toEqual([]);
        expect(result.degenerate.count).toBe(1);
        expect(result.degenerate.sample).toEqual([{ rowNumber: 2, suid: "BAD" }]);
        expect(result.totalRecords).toBe(3);
      });

      it("should read each geometry by its record index, without a transform", () => {
        const { reader, readGeometry } = stubShp([GOOD, GOOD]);

        indexer.indexBinaryDbf(stubDbf(["A", "B"]), ["id"], undefined, reader);

        expect(readGeometry.mock.calls).toEqual([[0], [1]]);
      });

      it("should count a degenerate record with an empty key as degenerate, not as a null record", () => {
        const { reader } = stubShp([COLLAPSED]);

        const result = indexer.indexBinaryDbf(stubDbf([""]), ["id"], undefined, reader);

        expect(result.degenerate.count).toBe(1);
        expect(result.nullRecordIndices).toEqual([]);
      });

      it("should skip the degenerate record before the placeholder rule, with the option on", () => {
        const { reader } = stubShp([COLLAPSED, GOOD]);

        const result = indexer.indexBinaryDbf(stubDbf(["N/A", "X1"]), ["id"], { treatPlaceholdersAsEmpty: true }, reader);

        expect(result.nullRecordIndices).toEqual([]);
        expect(result.degenerate.count).toBe(1);
        expect(Array.from(result.suidMap.keys())).toEqual(["x1"]);
      });

      it("should never read geometry without a reader (the CSV and the keys-only paths) and return an empty collector", () => {
        const result = indexer.indexBinaryDbf(stubDbf(["A", "B"]), ["id"]);

        expect(result.degenerate.count).toBe(0);
        expect(Array.from(result.suidMap.keys())).toEqual(["a", "b"]);
      });

      it("should treat a null geometry as present, as before", () => {
        const { reader } = stubShp([null, GOOD]);

        const result = indexer.indexBinaryDbf(stubDbf(["A", "B"]), ["id"], undefined, reader);

        expect(result.degenerate.count).toBe(0);
        expect(result.suidMap.size).toBe(2);
      });

      it("should keep only the first 20 examples when more records are degenerate", () => {
        const geometries = Array.from({ length: 25 }, () => COLLAPSED);
        const { reader } = stubShp(geometries);

        const result = indexer.indexBinaryDbf(stubDbf(geometries.map((_, index) => `K${index}`)), ["id"], undefined, reader);

        expect(result.degenerate.count).toBe(25);
        expect(result.degenerate.sample).toHaveLength(20);
        expect(result.suidMap.size).toBe(0);
      });
    });
  });
});
