import { describe, it, expect } from "vitest";
import { SuidKeyResolver } from "@/core/workers/comparison/SuidKeyResolver";

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

  describe("buildCompositeKey placeholder handling", () => {
    it.each(["", "N/A", "n/a", "S/N", "SN", "NULL", "null"])(
      "should return empty key for all-placeholder value %j when option is on",
      (placeholder) => {
        // Act
        const key = resolver.buildCompositeKey({ id: placeholder }, ["id"], {
          treatPlaceholdersAsEmpty: true,
        });

        // Assert
        expect(key).toBe("");
      }
    );

    it("should keep N/A as a real value when option is omitted or false", () => {
      // Act / Assert
      expect(resolver.buildCompositeKey({ id: "N/A" }, ["id"])).toBe("n/a");
      expect(
        resolver.buildCompositeKey({ id: "N/A" }, ["id"], { treatPlaceholdersAsEmpty: false })
      ).toBe("n/a");
    });

    it("should keep mixed-key positions and treat 'a|' equal to 'a|n/a' only when option is on", () => {
      // Arrange
      const cols = ["x", "y"];
      const withEmpty = { x: "a", y: "" };
      const withNa = { x: "a", y: "n/a" };
      const on = { treatPlaceholdersAsEmpty: true };

      // Act / Assert
      expect(resolver.buildCompositeKey(withNa, cols, on)).toBe("a|");
      expect(resolver.buildCompositeKey(withEmpty, cols, on)).toBe(
        resolver.buildCompositeKey(withNa, cols, on)
      );
      expect(resolver.buildCompositeKey(withEmpty, cols)).not.toBe(
        resolver.buildCompositeKey(withNa, cols)
      );
    });

    it("should not strip placeholders that are only part of a longer value", () => {
      // Act
      const key = resolver.buildCompositeKey({ id: "N/A 5" }, ["id"], {
        treatPlaceholdersAsEmpty: true,
      });

      // Assert
      expect(key).toBe("n/a 5");
    });

    it("should return empty key when all parts of a composite are placeholders", () => {
      // Act
      const key = resolver.buildCompositeKey({ x: "S/N", y: "NULL" }, ["x", "y"], {
        treatPlaceholdersAsEmpty: true,
      });

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
