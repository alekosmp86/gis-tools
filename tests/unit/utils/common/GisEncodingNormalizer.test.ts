import { describe, it, expect } from "vitest";
import { GisEncodingNormalizer } from "@/core/common/GisEncodingNormalizer";

describe("GisEncodingNormalizer", () => {
  describe("hasCorruptedGlyphs", () => {
    it("should return false for clean standard Spanish text", () => {
      // Arrange
      const cleanText = "INSTRUCCIONES DEL AÑO XIII";

      // Act
      const result = GisEncodingNormalizer.hasCorruptedGlyphs(cleanText);

      // Assert
      expect(result).toBe(false);
    });

    it("should return true when text contains Hangul syllables from DBCS corruption", () => {
      // Arrange
      const corruptedText = "INSTRUCCIONES DEL A헡 XIII";

      // Act
      const result = GisEncodingNormalizer.hasCorruptedGlyphs(corruptedText);

      // Assert
      expect(result).toBe(true);
    });

    it("should return true when text contains Unicode replacement character", () => {
      // Arrange
      const corruptedText = "CALLE ESPA\uFFFDA";

      // Act
      const result = GisEncodingNormalizer.hasCorruptedGlyphs(corruptedText);

      // Assert
      expect(result).toBe(true);
    });

    it("should return true when text contains CJK ideographs", () => {
      // Arrange
      const corruptedText = "RUTA \u4E00 12";

      // Act
      const result = GisEncodingNormalizer.hasCorruptedGlyphs(corruptedText);

      // Assert
      expect(result).toBe(true);
    });

    it("should return false for empty or non-string inputs", () => {
      // Arrange & Act & Assert
      expect(GisEncodingNormalizer.hasCorruptedGlyphs("")).toBe(false);
      expect(GisEncodingNormalizer.hasCorruptedGlyphs(null as unknown as string)).toBe(false);
      expect(GisEncodingNormalizer.hasCorruptedGlyphs(undefined as unknown as string)).toBe(false);
    });
  });

  describe("algorithmicUnmojibake", () => {
    it("should recover UTF-8 Spanish characters incorrectly read as Windows-1252", () => {
      // Arrange
      const inputs = [
        { mojibake: "PEÃ‘AROL", expected: "PEÑAROL" },
        { mojibake: "CABAÃ‘A", expected: "CABAÑA" },
        { mojibake: "MÃ‰NDEZ", expected: "MÉNDEZ" },
        { mojibake: "ÃšLTIMO", expected: "ÚLTIMO" },
        { mojibake: "niÃ±o", expected: "niño" },
        { mojibake: "canciÃ³n", expected: "canción" },
      ];

      // Act & Assert
      for (const item of inputs) {
        const recovered = GisEncodingNormalizer.algorithmicUnmojibake(item.mojibake);
        expect(recovered).toBe(item.expected);
      }
    });

    it("should return unchanged text if no multi-byte mojibake lead characters exist", () => {
      // Arrange
      const standardText = "AVENIDA ITALIA 1234";

      // Act
      const result = GisEncodingNormalizer.algorithmicUnmojibake(standardText);

      // Assert
      expect(result).toBe(standardText);
    });
  });

  describe("areAttributesEquivalent", () => {
    it("should return true for exact matches without normalization", () => {
      // Arrange & Act
      const result = GisEncodingNormalizer.areAttributesEquivalent(
        "COLONIA DEL SACRAMENTO",
        "COLONIA DEL SACRAMENTO"
      );

      // Assert
      expect(result).toBe(true);
    });

    it("should resolve Hangul double-byte corruption against clean database text when tolerance is enabled", () => {
      // Arrange
      const dbValue = "INSTRUCCIONES DEL AÑO XIII";
      const fileValue = "INSTRUCCIONES DEL A헡 XIII";

      // Act
      const result = GisEncodingNormalizer.areAttributesEquivalent(dbValue, fileValue, {
        ignoreEncodingArtifacts: true,
      });

      // Assert
      expect(result).toBe(true);
    });

    it("should reject corrupted match when tolerance is disabled", () => {
      // Arrange
      const dbValue = "INSTRUCCIONES DEL AÑO XIII";
      const fileValue = "INSTRUCCIONES DEL A헡 XIII";

      // Act
      const result = GisEncodingNormalizer.areAttributesEquivalent(dbValue, fileValue, {
        ignoreEncodingArtifacts: false,
      });

      // Assert
      expect(result).toBe(false);
    });

    it("should strictly enforce case sensitivity even when corrupted", () => {
      // Arrange: Lowercase file value against Uppercase DB value
      const dbValue = "INSTRUCCIONES DEL AÑO XIII";
      const fileValue = "instrucciones del a헡 xiii";

      // Act
      const result = GisEncodingNormalizer.areAttributesEquivalent(dbValue, fileValue, {
        ignoreEncodingArtifacts: true,
      });

      // Assert
      expect(result).toBe(false);
    });

    it("should strictly enforce punctuation sensitivity", () => {
      // Arrange: Extra comma in file value
      const dbValue = "INSTRUCCIONES DEL AÑO XIII";
      const fileValue = "INSTRUCCIONES DEL A헡, XIII";

      // Act
      const result = GisEncodingNormalizer.areAttributesEquivalent(dbValue, fileValue, {
        ignoreEncodingArtifacts: true,
      });

      // Assert
      expect(result).toBe(false);
    });

    it("should resolve UTF-8 mojibake equivalence seamlessly", () => {
      // Arrange
      const dbValue = "PEÑAROL";
      const fileValue = "PEÃ‘AROL";

      // Act
      const result = GisEncodingNormalizer.areAttributesEquivalent(dbValue, fileValue, {
        ignoreEncodingArtifacts: true,
      });

      // Assert
      expect(result).toBe(true);
    });

    it("should handle null and undefined appropriately", () => {
      // Arrange & Act & Assert
      expect(GisEncodingNormalizer.areAttributesEquivalent(null, null)).toBe(true);
      expect(GisEncodingNormalizer.areAttributesEquivalent("", "")).toBe(true);
      expect(GisEncodingNormalizer.areAttributesEquivalent(null, "")).toBe(false);
      expect(GisEncodingNormalizer.areAttributesEquivalent("ABC", null)).toBe(false);
    });
  });
});
