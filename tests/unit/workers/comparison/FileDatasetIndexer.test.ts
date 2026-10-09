import { describe, it, expect } from "vitest";
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
});
