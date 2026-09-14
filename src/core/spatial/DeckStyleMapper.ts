import type { Feature } from "geojson";
import type { MapFeatureStyle } from "@/core/types/map";
import { getDiscrepancyColor } from "@/core/constants/mapConstants";

/**
 * Converts a hex color string (#rgb, #rrggbb, or #rrggbbaa) and opacity (0..1)
 * into a deck.gl RGBA tuple [r, g, b, a] where each component is 0..255.
 */
export function hexToRgba(hex: string, opacity: number = 1): [number, number, number, number] {
  if (!hex || typeof hex !== "string") {
    return [0, 0, 0, Math.round(Math.max(0, Math.min(1, opacity)) * 255)];
  }

  const cleanHex = hex.replace("#", "").trim();
  const clampedOpacity = Math.max(0, Math.min(1, opacity));
  const alphaByte = Math.round(clampedOpacity * 255);

  if (cleanHex.length === 3) {
    const red = parseInt(cleanHex[0] + cleanHex[0], 16);
    const green = parseInt(cleanHex[1] + cleanHex[1], 16);
    const blue = parseInt(cleanHex[2] + cleanHex[2], 16);
    return [
      Number.isNaN(red) ? 0 : red,
      Number.isNaN(green) ? 0 : green,
      Number.isNaN(blue) ? 0 : blue,
      alphaByte,
    ];
  }

  if (cleanHex.length === 6 || cleanHex.length === 8) {
    const red = parseInt(cleanHex.substring(0, 2), 16);
    const green = parseInt(cleanHex.substring(2, 4), 16);
    const blue = parseInt(cleanHex.substring(4, 6), 16);
    return [
      Number.isNaN(red) ? 0 : red,
      Number.isNaN(green) ? 0 : green,
      Number.isNaN(blue) ? 0 : blue,
      alphaByte,
    ];
  }

  return [0, 0, 0, alphaByte];
}

/**
 * Computes the stroke RGBA color for a GeoJSON feature based on MapFeatureStyle
 * and optional discrepancy properties.
 */
export function getFeatureStrokeColor(
  feature: Feature,
  style: MapFeatureStyle
): [number, number, number, number] {
  const discrepancyType = feature.properties?._discrepancyType;
  const useDiscrepancy = !style.overrideDiscrepancyColors && typeof discrepancyType === "string" && discrepancyType;

  const strokeHex = useDiscrepancy ? getDiscrepancyColor(discrepancyType) : style.color;
  return hexToRgba(strokeHex, style.opacity);
}

/**
 * Computes the fill RGBA color for a GeoJSON feature based on MapFeatureStyle
 * and optional discrepancy properties.
 */
export function getFeatureFillColor(
  feature: Feature,
  style: MapFeatureStyle
): [number, number, number, number] {
  const discrepancyType = feature.properties?._discrepancyType;
  const useDiscrepancy = !style.overrideDiscrepancyColors && typeof discrepancyType === "string" && discrepancyType;

  const fillHex = useDiscrepancy ? getDiscrepancyColor(discrepancyType) : style.fillColor;
  return hexToRgba(fillHex, style.fillOpacity);
}
