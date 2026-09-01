import L from "leaflet";
import type { Feature } from "geojson";
import { buildPopupHtml } from "@/utils/mapPopupBuilder";

export function bindFeatureEvents(
  feature: Feature,
  layer: L.Layer,
  geojsonFeatures: Feature[],
  onSelectFeature?: (index: number | null) => void
): void {
  layer.on("click", () => {
    const popupHtml = buildPopupHtml(feature);
    if (popupHtml) {
      layer
        .bindPopup(popupHtml, {
          closeButton: true,
          autoPan: true,
          maxWidth: 310,
        })
        .openPopup();
    }
    if (onSelectFeature) {
      const targetIndex =
        typeof feature?.properties?._featureIndex === "number"
          ? feature.properties._featureIndex
          : geojsonFeatures.indexOf(feature);
      if (targetIndex !== -1 && targetIndex !== undefined) {
        onSelectFeature(targetIndex);
      }
    }
  });
}
