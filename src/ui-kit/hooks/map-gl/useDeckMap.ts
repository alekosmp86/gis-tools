import { useEffect } from "react";
import type { FeatureCollection } from "geojson";
import type { MapFeatureStyle } from "@/core/types/map";
import { ViewportFeatureIndex } from "@/core/spatial/ViewportFeatureIndex";
import { useDeckMapInstance } from "./useDeckMapInstance";
import { useMapLibreBasemap } from "./useMapLibreBasemap";
import { useDeckViewportWindow } from "./useDeckViewportWindow";
import { useDeckFeatureLayers } from "./useDeckFeatureLayers";
import { useDeckFeatureHighlight } from "./useDeckFeatureHighlight";

export function useDeckMap(
  mapContainerNode: HTMLDivElement | null,
  geojson: FeatureCollection,
  basemapKey: string,
  featureStyle: MapFeatureStyle,
  selectedFeatureIndex?: number | null,
  onSelectFeature?: (index: number | null) => void,
  isVisible: boolean = true,
  maxRenderFeatures: number | null = null
): {
  renderedCount: number;
  handleFitBounds: () => void;
} {
  const { mapInstanceRef, deckOverlayRef, isMapReady } = useDeckMapInstance(mapContainerNode);
  useMapLibreBasemap(mapInstanceRef, basemapKey, isMapReady);

  const windowedCollection = useDeckViewportWindow(
    mapInstanceRef,
    geojson,
    isMapReady,
    maxRenderFeatures,
    isVisible
  );

  const dataLayer = useDeckFeatureLayers(
    windowedCollection,
    featureStyle,
    onSelectFeature,
    geojson?.features
  );

  const highlightLayer = useDeckFeatureHighlight(
    mapInstanceRef,
    geojson,
    selectedFeatureIndex,
    isMapReady
  );

  useEffect(() => {
    const overlay = deckOverlayRef.current;
    if (!overlay || !isMapReady) return;

    const activeLayers = [dataLayer, highlightLayer].filter(Boolean);
    overlay.setProps({ layers: activeLayers });
  }, [deckOverlayRef, isMapReady, dataLayer, highlightLayer]);

  const handleFitBounds = () => {
    const map = mapInstanceRef.current;
    if (!map || !geojson?.features || geojson.features.length === 0) return;

    const spatialIndex = new ViewportFeatureIndex(geojson.features);
    const collectionBounds = spatialIndex.getCollectionBBox();
    if (collectionBounds) {
      map.fitBounds(
        [
          [collectionBounds[0], collectionBounds[1]],
          [collectionBounds[2], collectionBounds[3]],
        ],
        { padding: 40 }
      );
    }
  };

  const renderedCount = windowedCollection?.features?.length ?? 0;

  return {
    renderedCount,
    handleFitBounds,
  };
}
