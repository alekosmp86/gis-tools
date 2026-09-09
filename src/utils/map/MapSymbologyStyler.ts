import L from "leaflet";
import type { Feature } from "geojson";
import { getDiscrepancyColor, getDashArrayFromPattern } from "@/constants/mapConstants";
import type { MapFeatureStyle } from "@/types/map";

/** Cache key used for features that carry no discrepancy type. */
const DEFAULT_DISCREPANCY_KEY = "__default__";

/**
 * Resolves symbology for a batch of features sharing one style and renderer, reusing the computed
 * path options across every feature of the same discrepancy type.
 */
export interface FeatureStyleResolver {
  resolvePathStyle(feature: Feature | undefined): L.PathOptions;
  createPointLayer(feature: Feature | undefined, latlng: L.LatLng): L.CircleMarker;
}

/**
 * MapSymbologyStyler
 * Object-Oriented Presenter for Leaflet vector symbology, stroke formatting, and discrepancy theming.
 */
export class MapSymbologyStyler {
  /**
   * Shared stateless instance. Symbology is computed once per feature during chunked rendering, so
   * allocating a presenter per call showed up as tens of thousands of throwaway objects per render.
   */
  private static readonly sharedInstance = new MapSymbologyStyler();
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

  /**
   * Builds a resolver bound to one style and renderer. Path options are computed once per
   * discrepancy type and shared across features: Leaflet copies the options onto each layer rather
   * than retaining the source object, so sharing is safe.
   */
  public createStyleResolver(
    currentStyle: MapFeatureStyle,
    canvasRenderer: L.Canvas | null
  ): FeatureStyleResolver {
    const pathStyleCache = new Map<string, L.PathOptions>();

    return {
      resolvePathStyle: (feature) => {
        const cacheKey = this.resolveDiscrepancyKey(feature);
        const cachedStyle = pathStyleCache.get(cacheKey);
        if (cachedStyle) {
          return cachedStyle;
        }

        const computedStyle = this.computePathStyle(feature, currentStyle, canvasRenderer);
        pathStyleCache.set(cacheKey, computedStyle);
        return computedStyle;
      },
      createPointLayer: (feature, latlng) =>
        this.createPointMarker(feature, latlng, currentStyle, canvasRenderer),
    };
  }

  private resolveDiscrepancyKey(feature: Feature | undefined): string {
    const discrepancyType = feature?.properties?._discrepancyType;
    return typeof discrepancyType === "string" ? discrepancyType : DEFAULT_DISCREPANCY_KEY;
  }

  public static createStyleResolver(
    currentStyle: MapFeatureStyle,
    canvasRenderer: L.Canvas | null
  ): FeatureStyleResolver {
    return MapSymbologyStyler.sharedInstance.createStyleResolver(currentStyle, canvasRenderer);
  }
}

/** Convenience export */
export const createStyleResolver = MapSymbologyStyler.createStyleResolver;
