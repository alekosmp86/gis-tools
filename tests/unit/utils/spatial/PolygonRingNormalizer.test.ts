import { describe, it, expect } from "vitest";
import { PolygonRingNormalizer } from "@/core/spatial/PolygonRingNormalizer";

describe("PolygonRingNormalizer", () => {
  const normalizer = new PolygonRingNormalizer(10000); // 4 decimal places

  describe("normalizeRing", () => {
    it("should remove duplicate closing endpoint", () => {
      // Arrange
      const ring: Array<[number, number]> = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0], // closing endpoint
      ];

      // Act
      const normalized = normalizer.normalizeRing(ring);

      // Assert
      expect(normalized).toHaveLength(4);
    });

    it("should collapse consecutive duplicate vertices", () => {
      // Arrange
      const ringWithDuplicates: Array<[number, number]> = [
        [0, 0],
        [0, 0], // consecutive duplicate
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ];

      // Act
      const normalized = normalizer.normalizeRing(ringWithDuplicates);

      // Assert
      expect(normalized).toHaveLength(4);
    });

    it("should canonicalize starting vertex to the lexicographically smallest coordinate", () => {
      // Arrange: Two rings having the same shape but different starting vertex
      const ringA: Array<[number, number]> = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ];
      const ringB: Array<[number, number]> = [
        [1, 1],
        [0, 1],
        [0, 0],
        [1, 0],
        [1, 1],
      ];

      // Act
      const normA = normalizer.normalizeRing(ringA);
      const normB = normalizer.normalizeRing(ringB);

      // Assert
      expect(normA).toEqual(normB);
    });
  });

  describe("areRingsTopologicallyMatching", () => {
    it("should return isMatch true for identical rings", () => {
      // Arrange
      const ring1: Array<[number, number]> = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ];
      const ring2: Array<[number, number]> = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ];

      // Act
      const result = normalizer.areRingsTopologicallyMatching(ring1, ring2);

      // Assert
      expect(result.isMatch).toBe(true);
    });

    it("should return isMatch false for rings with different vertex counts", () => {
      // Arrange
      const triangle: Array<[number, number]> = [
        [0, 0],
        [1, 0],
        [0, 1],
        [0, 0],
      ];
      const square: Array<[number, number]> = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ];

      // Act
      const result = normalizer.areRingsTopologicallyMatching(triangle, square);

      // Assert
      expect(result.isMatch).toBe(false);
      expect(result.mismatchDetail).toContain("Vértices");
    });
  });
});
