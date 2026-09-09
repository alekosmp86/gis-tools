import { describe, it, expect } from "vitest";
import {
  SpatialFileFormat,
  CatalogFormatFilter,
  isCsvFormat,
  isShapefileCompatibleFormat,
} from "@/modules/cartography-watcher/types/watcher";

describe("watcher format constants and classifiers", () => {
  describe("isCsvFormat", () => {
    it("should return true for csv variations", () => {
      expect(isCsvFormat("CSV")).toBe(true);
      expect(isCsvFormat("csv")).toBe(true);
      expect(isCsvFormat("  csv  ")).toBe(true);
    });

    it("should return false for non-csv formats", () => {
      expect(isCsvFormat("SHP")).toBe(false);
      expect(isCsvFormat("ZIP")).toBe(false);
      expect(isCsvFormat(null)).toBe(false);
      expect(isCsvFormat(undefined)).toBe(false);
    });
  });

  describe("isShapefileCompatibleFormat", () => {
    it("should return true for all shapefile and vector formats", () => {
      expect(isShapefileCompatibleFormat("SHP")).toBe(true);
      expect(isShapefileCompatibleFormat("shp")).toBe(true);
      expect(isShapefileCompatibleFormat("ZIP")).toBe(true);
      expect(isShapefileCompatibleFormat("GEOJSON")).toBe(true);
      expect(isShapefileCompatibleFormat("JSON")).toBe(true);
      expect(isShapefileCompatibleFormat("SHP (ZIP)")).toBe(true);
    });

    it("should return false for tabular or unrelated formats", () => {
      expect(isShapefileCompatibleFormat("CSV")).toBe(false);
      expect(isShapefileCompatibleFormat("XLSX")).toBe(false);
      expect(isShapefileCompatibleFormat(null)).toBe(false);
      expect(isShapefileCompatibleFormat(undefined)).toBe(false);
    });
  });

  describe("SpatialFileFormat and CatalogFormatFilter constants", () => {
    it("should contain expected constant values", () => {
      expect(SpatialFileFormat.CSV).toBe("CSV");
      expect(SpatialFileFormat.SHP).toBe("SHP");
      expect(SpatialFileFormat.ZIP).toBe("ZIP");
      expect(SpatialFileFormat.GEOJSON).toBe("GEOJSON");
      expect(SpatialFileFormat.JSON).toBe("JSON");

      expect(CatalogFormatFilter.ALL).toBe("ALL");
      expect(CatalogFormatFilter.CSV).toBe("CSV");
      expect(CatalogFormatFilter.SHP).toBe("SHP");
    });
  });
});
