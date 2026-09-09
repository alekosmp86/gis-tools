import L from "leaflet";
import type { Feature } from "geojson";
import { MapPopupPresenter } from "./MapPopupPresenter";

/** Popup presentation shared by every feature popup. */
const FEATURE_POPUP_OPTIONS: L.PopupOptions = {
  closeButton: true,
  autoPan: true,
  maxWidth: 310,
};

/**
 * MapEventHandler
 * Object-Oriented Mediator/Handler for Leaflet layer user interactions and selection routing.
 */
export class MapEventHandler {
  /** Shared stateless instance; one handler serves every rendered group. */
  private static readonly sharedInstance = new MapEventHandler();

  private readonly popupPresenter = new MapPopupPresenter();

  /**
   * Binds a single delegated click listener on the parent group rather than one listener per
   * feature, which previously allocated a closure and an event registration for every rendered
   * geometry.
   *
   * Leaflet propagates layer events up to parent groups. Because rendered chunks are nested
   * (`path` -> `L.GeoJSON` sub-group -> feature group), `event.layer` resolves to the intermediate
   * sub-group after the second hop; `sourceTarget` is the only property that still identifies the
   * clicked geometry.
   */
  public bindGroupEvents(
    featureGroup: L.FeatureGroup,
    sourceFeatures: Feature[],
    onSelectFeature?: (index: number | null) => void
  ): void {
    featureGroup.on("click", (event: L.LeafletEvent) => {
      const originLayer: L.Layer | undefined = event.sourceTarget ?? event.propagatedFrom;
      if (!originLayer) return;

      const clickedFeature = (originLayer as L.Layer & { feature?: Feature }).feature;
      if (!clickedFeature) return;

      const popupHtml = this.popupPresenter.buildPopupHtml(clickedFeature);
      if (popupHtml) {
        originLayer.bindPopup(popupHtml, FEATURE_POPUP_OPTIONS).openPopup();
      }

      if (onSelectFeature) {
        const targetIndex = sourceFeatures.indexOf(clickedFeature);
        if (targetIndex !== -1) {
          onSelectFeature(targetIndex);
        }
      }
    });
  }

  public static bindGroupEvents(
    featureGroup: L.FeatureGroup,
    sourceFeatures: Feature[],
    onSelectFeature?: (index: number | null) => void
  ): void {
    MapEventHandler.sharedInstance.bindGroupEvents(
      featureGroup,
      sourceFeatures,
      onSelectFeature
    );
  }
}

/** Convenience export */
export const bindGroupFeatureEvents = MapEventHandler.bindGroupEvents;
