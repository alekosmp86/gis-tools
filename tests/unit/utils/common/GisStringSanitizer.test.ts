import { describe, it, expect } from "vitest";
import { GisStringSanitizer } from "@/core/common/GisStringSanitizer";

describe("GisStringSanitizer", () => {
  describe("cleanValue", () => {
    it("should return empty string for null and undefined", () => {
      // Arrange & Act & Assert
      expect(GisStringSanitizer.cleanValue(null)).toBe("");
      expect(GisStringSanitizer.cleanValue(undefined)).toBe("");
    });

    it("should trim surrounding whitespace, newlines, tabs, and non-breaking spaces", () => {
      // Arrange
      const messy = " \t\r\nHello World\xa0 ";

      // Act
      const cleaned = GisStringSanitizer.cleanValue(messy);

      // Assert
      expect(cleaned).toBe("Hello World");
    });

    it("should strip surrounding single and double quotes", () => {
      // Arrange
      const doubleQuoted = '"TA014I111T9"';
      const singleQuoted = "'TA014I111T9'";

      // Act & Assert
      expect(GisStringSanitizer.cleanValue(doubleQuoted)).toBe("TA014I111T9");
      expect(GisStringSanitizer.cleanValue(singleQuoted)).toBe("TA014I111T9");
    });

    it("should strip floating point '.0' suffix from integer strings", () => {
      // Arrange & Act & Assert
      expect(GisStringSanitizer.cleanValue("1002.0")).toBe("1002");
      expect(GisStringSanitizer.cleanValue("1002.05")).toBe("1002.05");
      expect(GisStringSanitizer.cleanValue("0.0")).toBe("0");
    });
  });

  describe("cleanSuid", () => {
    it("should lower-case and repair encoding for SUID matching", () => {
      // Arrange
      const rawSuid = "  CABAÃ‘A  ";

      // Act
      const cleaned = GisStringSanitizer.cleanSuid(rawSuid);

      // Assert
      expect(cleaned).toBe("cabaña");
    });

    it("should handle numeric inputs converted to SUID", () => {
      // Arrange
      const numericSuid = 54321;

      // Act
      const cleaned = GisStringSanitizer.cleanSuid(numericSuid);

      // Assert
      expect(cleaned).toBe("54321");
    });
  });

  describe("areValuesEquivalent", () => {
    it("should equate values having surrounding quotes or whitespace differences", () => {
      // Arrange
      const dbVal = "URUGUAY";
      const fileVal = ' "URUGUAY" ';

      // Act
      const result = GisStringSanitizer.areValuesEquivalent(dbVal, fileVal);

      // Assert
      expect(result).toBe(true);
    });

    it("should equate numeric string with .0 suffix", () => {
      // Arrange
      const dbVal = "450";
      const fileVal = "450.0";

      // Act
      const result = GisStringSanitizer.areValuesEquivalent(dbVal, fileVal);

      // Assert
      expect(result).toBe(true);
    });
  });
});
