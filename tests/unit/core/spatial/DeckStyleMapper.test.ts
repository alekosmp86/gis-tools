import { describe, it, expect } from "vitest";
import type { Feature } from "geojson";
import { DiscrepancyType } from "@/core/types/comparison";
import { MapStrokePattern, type MapFeatureStyle } from "@/core/types/map";
import {
  hexToRgba,
  getFeatureStrokeColor,
  getFeatureFillColor,
} from "@/core/spatial/DeckStyleMapper";

describe("DeckStyleMapper", () => {
  describe("hexToRgba", () => {
    it("should convert 6-character hex color to RGBA tuple with full opacity", () => {
      // Arrange
      const hex = "#06b6d4";

      // Act
      const result = hexToRgba(hex, 1);

      // Assert
      expect(result).toEqual([6, 182, 212, 255]);
    });

    it("should convert 3-character hex color to RGBA tuple with custom opacity", () => {
      // Arrange
      const hex = "#fff";
      const opacity = 0.5;

      // Act
      const result = hexToRgba(hex, opacity);

      // Assert
      expect(result).toEqual([255, 255, 255, 128]);
    });

    it("should clamp opacity within boundary limits [0, 1]", () => {
      // Arrange
      const hex = "#000000";

      // Act
      const resultNegative = hexToRgba(hex, -0.5);
      const resultExceeded = hexToRgba(hex, 1.5);

      // Assert
      expect(resultNegative[3]).toBe(0);
      expect(resultExceeded[3]).toBe(255);
    });

    it("should fallback safely when given invalid or empty hex string", () => {
      // Arrange & Act
      const resultInvalid = hexToRgba("not-a-color", 0.8);
      const resultEmpty = hexToRgba("", 1);

      // Assert
      expect(resultInvalid).toEqual([0, 0, 0, 204]);
      expect(resultEmpty).toEqual([0, 0, 0, 255]);
    });
  });

  describe("getFeatureStrokeColor and getFeatureFillColor", () => {
    const baseStyle: MapFeatureStyle = {
      color: "#3b82f6",
      fillColor: "#10b981",
      weight: 3,
      opacity: 0.9,
      fillOpacity: 0.4,
      pointRadius: 6,
      strokePattern: MapStrokePattern.SOLID,
      overrideDiscrepancyColors: false,
    };

    it("should return base style colors when feature has no discrepancy type", () => {
      // Arrange
      const plainFeature: Feature = {
        type: "Feature",
        geometry: { type: "Point", coordinates: [0, 0] },
        properties: { name: "Normal Feature" },
      };

      // Act
      const strokeColor = getFeatureStrokeColor(plainFeature, baseStyle);
      const fillColor = getFeatureFillColor(plainFeature, baseStyle);

      // Assert: #3b82f6 -> [59, 130, 246], #10b981 -> [16, 185, 129]
      expect(strokeColor).toEqual([59, 130, 246, Math.round(0.9 * 255)]);
      expect(fillColor).toEqual([16, 185, 129, Math.round(0.4 * 255)]);
    });

    it("should map to discrepancy colors when discrepancy type is present and override is false", () => {
      // Arrange
      const mismatchFeature: Feature = {
        type: "Feature",
        geometry: { type: "Point", coordinates: [0, 0] },
        properties: { _discrepancyType: DiscrepancyType.GEOMETRY_MISMATCH },
      };

      // Act
      const strokeColor = getFeatureStrokeColor(mismatchFeature, baseStyle);
      const fillColor = getFeatureFillColor(mismatchFeature, baseStyle);

      // Assert: DiscrepancyType.GEOMETRY_MISMATCH is "#ff0055" -> [255, 0, 85]
      expect(strokeColor).toEqual([255, 0, 85, Math.round(0.9 * 255)]);
      expect(fillColor).toEqual([255, 0, 85, Math.round(0.4 * 255)]);
    });

    it("should ignore discrepancy colors and use base style when overrideDiscrepancyColors is true", () => {
      // Arrange
      const overrideStyle: MapFeatureStyle = {
        ...baseStyle,
        overrideDiscrepancyColors: true,
      };
      const mismatchFeature: Feature = {
        type: "Feature",
        geometry: { type: "Point", coordinates: [0, 0] },
        properties: { _discrepancyType: DiscrepancyType.GEOMETRY_MISMATCH },
      };

      // Act
      const strokeColor = getFeatureStrokeColor(mismatchFeature, overrideStyle);
      const fillColor = getFeatureFillColor(mismatchFeature, overrideStyle);

      // Assert: Must use base style colors rather than #ff0055
      expect(strokeColor).toEqual([59, 130, 246, Math.round(0.9 * 255)]);
      expect(fillColor).toEqual([16, 185, 129, Math.round(0.4 * 255)]);
    });
  });
});
