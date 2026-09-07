import { describe, it, expect } from "vitest";
import { FileDatasetIndexer } from "@/workers/comparison/FileDatasetIndexer";
import type { SerializableFileDataset } from "@/types/workerMessages";

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
  });
});
