import { describe, it, expect } from "vitest";
import { SuidKeyResolver } from "@/workers/comparison/SuidKeyResolver";

describe("SuidKeyResolver", () => {
  const resolver = new SuidKeyResolver();

  describe("buildCompositeKey", () => {
    it("should build a single normalized lower-cased key", () => {
      // Arrange
      const record = { id: "PADRON_123" };

      // Act
      const key = resolver.buildCompositeKey(record, ["id"]);

      // Assert
      expect(key).toBe("padron_123");
    });

    it("should build a composite pipe-delimited key across multiple columns", () => {
      // Arrange
      const record = { depto: "CANELONES", seccion: "05", padron: "9981" };

      // Act
      const key = resolver.buildCompositeKey(record, ["depto", "seccion", "padron"]);

      // Assert
      expect(key).toBe("canelones|05|9981");
    });

    it("should resolve column names case-insensitively", () => {
      // Arrange
      const record = { DEPTO: "MONTEVIDEO", Seccion: "01" };

      // Act
      const key = resolver.buildCompositeKey(record, ["depto", "seccion"]);

      // Assert
      expect(key).toBe("montevideo|01");
    });

    it("should return empty string if no valid parts exist", () => {
      // Arrange
      const record = { depto: null, seccion: "" };

      // Act
      const key = resolver.buildCompositeKey(record, ["depto", "seccion"]);

      // Assert
      expect(key).toBe("");
    });
  });

  describe("buildCompositeRawSuid", () => {
    it("should build human-friendly display representation with spaced pipes", () => {
      // Arrange
      const record = { depto: "SALTO", seccion: 63, paraje: "SALTO GRANDE" };

      // Act
      const displayKey = resolver.buildCompositeRawSuid(record, ["depto", "seccion", "paraje"]);

      // Assert
      expect(displayKey).toBe("SALTO | 63 | SALTO GRANDE");
    });
  });
});
