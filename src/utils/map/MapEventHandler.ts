import L from "leaflet";
import type { Feature } from "geojson";
import { MapPopupPresenter } from "./MapPopupPresenter";

/**
 * MapEventHandler
 * Object-Oriented Mediator/Handler for Leaflet layer user interactions and selection routing.
 */
export class MapEventHandler {
  private readonly popupPresenter = new MapPopupPresenter();

  /**
   * Binds click and selection events to a Leaflet layer.
   */
  public bindEvents(
    feature: Feature,
    layer: L.Layer,
    geojsonFeatures: Feature[],
    onSelectFeature?: (index: number | null) => void
  ): void {
    layer.on("click", () => {
      const popupHtml = this.popupPresenter.buildPopupHtml(feature);
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

  public static bindFeatureEvents(
    feature: Feature,
    layer: L.Layer,
    geojsonFeatures: Feature[],
    onSelectFeature?: (index: number | null) => void
  ): void {
    const handler = new MapEventHandler();
    handler.bindEvents(feature, layer, geojsonFeatures, onSelectFeature);
  }
}

/** Convenience export */
export const bindFeatureEvents = MapEventHandler.bindFeatureEvents;
