import L from "leaflet";
import type { Feature } from "geojson";
import { getDiscrepancyColor, getDashArrayFromPattern } from "@/constants/mapConstants";
import type { MapFeatureStyle } from "@/types/map";

/**
 * MapSymbologyStyler
 * Object-Oriented Presenter for Leaflet vector symbology, stroke formatting, and discrepancy theming.
 */
export class MapSymbologyStyler {
  /**
   * Computes Leaflet PathOptions for polygon, polyline, or geojson layers based on discrepancy states.
   */
  public computePathStyle(
    feature: Feature | undefined,
    currentStyle: MapFeatureStyle,
    canvasRenderer: L.Canvas | null
  ): L.PathOptions {
    const discrepancyType = feature?.properties?._discrepancyType;
    const useDiscrepancyColor = Boolean(discrepancyType && !currentStyle.overrideDiscrepancyColors);
    const strokeColor = useDiscrepancyColor ? getDiscrepancyColor(discrepancyType) : currentStyle.color;
    const fillColor = useDiscrepancyColor
      ? getDiscrepancyColor(discrepancyType)
      : currentStyle.fillColor || currentStyle.color;

    let featureDashArray = getDashArrayFromPattern(currentStyle.strokePattern);
    let featureFillOpacity = currentStyle.fillOpacity;

    if (discrepancyType === "FILE_FEATURE") {
      featureDashArray = "6, 6";
      featureFillOpacity = 0.25;
    } else if (discrepancyType === "DB_FEATURE") {
      featureDashArray = undefined;
      featureFillOpacity = 0.2;
    }

    return {
      renderer: canvasRenderer ?? undefined,
      color: strokeColor,
      weight: Math.max(currentStyle.weight, 3),
      opacity: currentStyle.opacity,
      fillColor,
      fillOpacity: featureFillOpacity,
      dashArray: featureDashArray,
    };
  }

  /**
   * Constructs an interactive L.CircleMarker with styling tailored for point features.
   */
  public createPointMarker(
    feature: Feature | undefined,
    latlng: L.LatLng,
    currentStyle: MapFeatureStyle,
    canvasRenderer: L.Canvas | null
  ): L.CircleMarker {
    const discrepancyType = feature?.properties?._discrepancyType;
    const useDiscrepancyColor = Boolean(discrepancyType && !currentStyle.overrideDiscrepancyColors);
    const strokeColor = useDiscrepancyColor ? getDiscrepancyColor(discrepancyType) : currentStyle.color;
    const fillColor = useDiscrepancyColor
      ? getDiscrepancyColor(discrepancyType)
      : currentStyle.fillColor || currentStyle.color;

    return L.circleMarker(latlng, {
      renderer: canvasRenderer ?? undefined,
      radius: currentStyle.pointRadius,
      fillColor,
      color: useDiscrepancyColor ? "#ffffff" : strokeColor,
      weight: Math.min(currentStyle.weight, 3),
      opacity: currentStyle.opacity,
      fillOpacity: Math.max(currentStyle.fillOpacity, 0.7),
    });
  }

  public static computeFeatureStyle(
    feature: Feature | undefined,
    currentStyle: MapFeatureStyle,
    canvasRenderer: L.Canvas | null
  ): L.PathOptions {
    const styler = new MapSymbologyStyler();
    return styler.computePathStyle(feature, currentStyle, canvasRenderer);
  }

  public static createPointToLayer(
    feature: Feature | undefined,
    latlng: L.LatLng,
    currentStyle: MapFeatureStyle,
    canvasRenderer: L.Canvas | null
  ): L.CircleMarker {
    const styler = new MapSymbologyStyler();
    return styler.createPointMarker(feature, latlng, currentStyle, canvasRenderer);
  }
}

/** Convenience exports */
export const computeFeatureStyle = MapSymbologyStyler.computeFeatureStyle;
export const createPointToLayer = MapSymbologyStyler.createPointToLayer;
