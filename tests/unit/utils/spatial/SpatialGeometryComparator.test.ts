import { describe, it, expect } from "vitest";
import { SpatialGeometryComparator } from "@/utils/spatial/SpatialGeometryComparator";

describe("SpatialGeometryComparator", () => {
  const comparator = new SpatialGeometryComparator();

  describe("compare - Point geometries", () => {
    it("should return match true for identical coordinates", () => {
      // Arrange
      const geomA = { type: "Point", coordinates: [-56.1645, -34.9011] };
      const geomB = { type: "Point", coordinates: [-56.1645, -34.9011] };

      // Act
      const result = comparator.compare(geomA, geomB);

      // Assert
      expect(result.isMatch).toBe(true);
    });

    it("should return match true when differences are within floating precision tolerance", () => {
      // Arrange: difference of 0.00001 (less than 4 decimal places precision threshold)
      const geomA = { type: "Point", coordinates: [-56.16451, -34.90112] };
      const geomB = { type: "Point", coordinates: [-56.16453, -34.90111] };

      // Act
      const result = comparator.compare(geomA, geomB);

      // Assert
      expect(result.isMatch).toBe(true);
    });

    it("should return match false when points differ significantly", () => {
      // Arrange
      const geomA = { type: "Point", coordinates: [-56.1645, -34.9011] };
      const geomB = { type: "Point", coordinates: [-56.25, -34.8] };

      // Act
      const result = comparator.compare(geomA, geomB);

      // Assert
      expect(result.isMatch).toBe(false);
      expect(result.details).toBeDefined();
    });
  });

  describe("compare - Cross-format comparison (WKT vs GeoJSON)", () => {
    it("should equate WKT Point and GeoJSON Point", () => {
      // Arrange
      const wkt = "POINT(-56.1645 -34.9011)";
      const geojson = { type: "Point", coordinates: [-56.1645, -34.9011] };

      // Act
      const result = comparator.compare(wkt, geojson);

      // Assert
      expect(result.isMatch).toBe(true);
    });
  });

  describe("compare - Null and missing geometries", () => {
    it("should return match true if both geometries are null", () => {
      // Arrange & Act
      const result = comparator.compare(null, null);

      // Assert
      expect(result.isMatch).toBe(true);
    });

    it("should return match false if one geometry is missing", () => {
      // Arrange
      const geom = { type: "Point", coordinates: [-56.1645, -34.9011] };

      // Act & Assert
      expect(comparator.compare(geom, null).isMatch).toBe(false);
      expect(comparator.compare(null, geom).isMatch).toBe(false);
    });
  });
});
