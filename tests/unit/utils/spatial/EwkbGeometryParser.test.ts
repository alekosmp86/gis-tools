import { describe, it, expect } from "vitest";
import { EwkbGeometryParser } from "@/core/spatial/EwkbGeometryParser";

describe("EwkbGeometryParser", () => {
  const parser = new EwkbGeometryParser();

  describe("isUtmCoordinates", () => {
    it("should recognize lat/lon degrees as non-UTM", () => {
      // Arrange & Act & Assert
      expect(EwkbGeometryParser.isUtmCoordinates(-56.1645, -34.9011)).toBe(false);
      expect(EwkbGeometryParser.isUtmCoordinates(0, 0)).toBe(false);
    });

    it("should recognize meter coordinates exceeding 180 or 90 as UTM", () => {
      // Arrange & Act & Assert
      expect(EwkbGeometryParser.isUtmCoordinates(584321, 6135890)).toBe(true);
    });
  });

  describe("parse - Point EWKB Hex", () => {
    it("should parse a 2D Point with SRID 4326 from hex string", () => {
      // Arrange:
      // Little Endian (01)
      // Type 1 with SRID (01 00 00 20)
      // SRID 4326 (e6 10 00 00)
      // X = -56.0, Y = -34.0
      // -56.0 in double IEEE754 little endian: 00 00 00 00 00 00 4c c0
      // -34.0 in double IEEE754 little endian: 00 00 00 00 00 00 41 c0
      const ewkbHex = "0101000020e61000000000000000004cc000000000000041c0";

      // Act
      const geometry = parser.parse(ewkbHex);

      // Assert
      expect(geometry).not.toBeNull();
      expect(geometry?.type).toBe("Point");
      if (geometry?.type === "Point") {
        expect(geometry.coordinates[0]).toBeCloseTo(-56.0, 4);
        expect(geometry.coordinates[1]).toBeCloseTo(-34.0, 4);
      }
    });

    it("should handle hex prefixed with \\x as returned by PostgreSQL pg driver", () => {
      // Arrange
      const ewkbWithPrefix = "\\x0101000020e61000000000000000004cc000000000000041c0";

      // Act
      const geometry = parser.parse(ewkbWithPrefix);

      // Assert
      expect(geometry).not.toBeNull();
      expect(geometry?.type).toBe("Point");
      if (geometry?.type === "Point") {
        expect(geometry.coordinates[0]).toBeCloseTo(-56.0, 4);
        expect(geometry.coordinates[1]).toBeCloseTo(-34.0, 4);
      }
    });
  });

  describe("parse - Edge cases", () => {
    it("should return null for invalid, truncated, or non-hex inputs", () => {
      // Arrange & Act & Assert
      expect(parser.parse(null)).toBeNull();
      expect(parser.parse("")).toBeNull();
      expect(parser.parse("010100")).toBeNull(); // Too short
      expect(parser.parse("NOT_A_HEX_STRING_AT_ALL_XYZ123456789")).toBeNull();
    });
  });
});
