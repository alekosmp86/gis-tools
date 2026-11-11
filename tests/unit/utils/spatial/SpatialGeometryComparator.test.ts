import { describe, it, expect } from "vitest";
import { SpatialGeometryComparator } from "@/core/spatial/SpatialGeometryComparator";

describe("SpatialGeometryComparator", () => {
  const comparator = new SpatialGeometryComparator();

  describe("compare - one-part Multi vs single geometries (CSV SRID bug)", () => {
    const lineCoords = [[-56.1, -34.9], [-56.2, -34.8]];

    it("SRID-24: should match a LineString with a one-part MultiLineString", () => {
      const result = comparator.compare(
        { type: "MultiLineString", coordinates: [lineCoords] },
        { type: "LineString", coordinates: lineCoords }
      );

      expect(result.isMatch).toBe(true);
    });

    it("SRID-25: should match in the opposite direction too", () => {
      const result = comparator.compare(
        { type: "LineString", coordinates: lineCoords },
        { type: "MultiLineString", coordinates: [lineCoords] }
      );

      expect(result.isMatch).toBe(true);
    });

    it("SRID-26: should not match a LineString with a two-part MultiLineString", () => {
      const result = comparator.compare(
        { type: "MultiLineString", coordinates: [lineCoords, [[-56.3, -34.7], [-56.4, -34.6]]] },
        { type: "LineString", coordinates: lineCoords }
      );

      expect(result.isMatch).toBe(false);
    });

    it("SRID-27: should not match a one-part MultiLineString whose coordinates differ", () => {
      const result = comparator.compare(
        { type: "MultiLineString", coordinates: [[[-50, -30], [-51, -31]]] },
        { type: "LineString", coordinates: lineCoords }
      );

      expect(result.isMatch).toBe(false);
    });

    it("SRID-28: should match a Point with a one-part MultiPoint", () => {
      const result = comparator.compare(
        { type: "MultiPoint", coordinates: [[-56.1645, -34.9011]] },
        { type: "Point", coordinates: [-56.1645, -34.9011] }
      );

      expect(result.isMatch).toBe(true);
    });

    it("SRID-29: should match a Polygon with a one-part MultiPolygon", () => {
      const rings = [[[0, 0], [1, 0], [1, 1], [0, 0]]];

      const result = comparator.compare(
        { type: "MultiPolygon", coordinates: [rings] },
        { type: "Polygon", coordinates: rings }
      );

      expect(result.isMatch).toBe(true);
    });
  });

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
