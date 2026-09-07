import { describe, it, expect } from "vitest";
import { WktGeometryParser } from "@/utils/spatial/WktGeometryParser";

describe("WktGeometryParser", () => {
  const parser = new WktGeometryParser();

  describe("parse - Point", () => {
    it("should parse standard 2D POINT", () => {
      // Arrange
      const wkt = "POINT(-56.1645 -34.9011)";

      // Act
      const geometry = parser.parse(wkt);

      // Assert
      expect(geometry).not.toBeNull();
      expect(geometry?.type).toBe("Point");
      if (geometry?.type === "Point") {
        expect(geometry.coordinates[0]).toBeCloseTo(-56.1645, 4);
        expect(geometry.coordinates[1]).toBeCloseTo(-34.9011, 4);
      }
    });

    it("should parse POINT with spaces around parentheses and negative coordinates", () => {
      // Arrange
      const wkt = "POINT ( -56.123 45.678 )";

      // Act
      const geometry = parser.parse(wkt);

      // Assert
      expect(geometry?.type).toBe("Point");
      if (geometry?.type === "Point") {
        expect(geometry.coordinates[0]).toBeCloseTo(-56.123, 3);
        expect(geometry.coordinates[1]).toBeCloseTo(45.678, 3);
      }
    });
  });

  describe("parse - LineString", () => {
    it("should parse LINESTRING with multiple vertices", () => {
      // Arrange
      const wkt = "LINESTRING(-56.1 -34.9, -56.2 -34.8, -56.3 -34.7)";

      // Act
      const geometry = parser.parse(wkt);

      // Assert
      expect(geometry?.type).toBe("LineString");
      if (geometry?.type === "LineString") {
        expect(geometry.coordinates).toHaveLength(3);
        expect(geometry.coordinates[0][0]).toBeCloseTo(-56.1, 2);
        expect(geometry.coordinates[2][1]).toBeCloseTo(-34.7, 2);
      }
    });
  });

  describe("parse - Polygon", () => {
    it("should parse standard single-ring POLYGON", () => {
      // Arrange
      const wkt = "POLYGON((-56.1 -34.9, -56.2 -34.9, -56.2 -34.8, -56.1 -34.8, -56.1 -34.9))";

      // Act
      const geometry = parser.parse(wkt);

      // Assert
      expect(geometry?.type).toBe("Polygon");
      if (geometry?.type === "Polygon") {
        expect(geometry.coordinates).toHaveLength(1); // 1 outer ring
        expect(geometry.coordinates[0]).toHaveLength(5);
        expect(geometry.coordinates[0][0][0]).toBeCloseTo(-56.1, 2);
      }
    });

    it("should parse POLYGON with exterior and interior rings (holes)", () => {
      // Arrange
      const wkt =
        "POLYGON((-56.0 -34.0, -56.5 -34.0, -56.5 -34.5, -56.0 -34.5, -56.0 -34.0), (-56.1 -34.1, -56.2 -34.1, -56.2 -34.2, -56.1 -34.2, -56.1 -34.1))";

      // Act
      const geometry = parser.parse(wkt);

      // Assert
      expect(geometry?.type).toBe("Polygon");
      if (geometry?.type === "Polygon") {
        expect(geometry.coordinates).toHaveLength(2); // exterior + 1 hole
      }
    });
  });

  describe("parse - Edge cases & invalid inputs", () => {
    it("should return null for null, undefined, or empty string", () => {
      // Arrange & Act & Assert
      expect(parser.parse(null)).toBeNull();
      expect(parser.parse(undefined)).toBeNull();
      expect(parser.parse("")).toBeNull();
      expect(parser.parse("   ")).toBeNull();
    });

    it("should return null for malformed or unknown geometry types", () => {
      // Arrange & Act & Assert
      expect(parser.parse("INVALID_GEOM(1 2)")).toBeNull();
      expect(parser.parse("POINT(1)")).toBeNull();
    });
  });
});
