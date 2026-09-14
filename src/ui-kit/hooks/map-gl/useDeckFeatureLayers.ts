import { GeoJsonLayer } from "@deck.gl/layers";
import type { FeatureCollection, Feature } from "geojson";
import type { MapFeatureStyle } from "@/core/types/map";
import { getFeatureFillColor, getFeatureStrokeColor } from "@/core/spatial/DeckStyleMapper";

export function useDeckFeatureLayers(
  windowedCollection: FeatureCollection,
  featureStyle: MapFeatureStyle,
  onSelectFeature?: (index: number | null) => void,
  allFeatures?: Feature[]
): GeoJsonLayer | null {
  if (!windowedCollection?.features || windowedCollection.features.length === 0) {
    return null;
  }

  return new GeoJsonLayer({
    id: "deck-geojson-vector-layer",
    data: windowedCollection.features,
    pickable: true,
    autoHighlight: false,
    filled: true,
    getFillColor: (feature: Feature) => getFeatureFillColor(feature, featureStyle),
    stroked: true,
    getLineColor: (feature: Feature) => getFeatureStrokeColor(feature, featureStyle),
    getLineWidth: featureStyle.weight,
    lineWidthUnits: "pixels",
    pointType: "circle",
    getPointRadius: featureStyle.pointRadius,
    pointRadiusUnits: "pixels",
    onClick: (info) => {
      if (!info.object || !onSelectFeature) return;
      const clickedFeature = info.object as Feature;

      let resolvedIndex = -1;
      if (allFeatures) {
        resolvedIndex = allFeatures.indexOf(clickedFeature);
      }
      if (resolvedIndex === -1 && typeof clickedFeature.properties?._recordIndex === "number") {
        resolvedIndex = clickedFeature.properties._recordIndex;
      }
      if (resolvedIndex === -1 && typeof info.index === "number") {
        resolvedIndex = info.index;
      }

      if (resolvedIndex >= 0) {
        onSelectFeature(resolvedIndex);
      }
    },
    updateTriggers: {
      getFillColor: [
        featureStyle.fillColor,
        featureStyle.fillOpacity,
        featureStyle.overrideDiscrepancyColors,
      ],
      getLineColor: [
        featureStyle.color,
        featureStyle.opacity,
        featureStyle.overrideDiscrepancyColors,
      ],
      getLineWidth: [featureStyle.weight],
      getPointRadius: [featureStyle.pointRadius],
    },
  });
}
