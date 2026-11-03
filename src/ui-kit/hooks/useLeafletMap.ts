import type { FeatureCollection } from "geojson";
import type { MapFeatureStyle } from "@/core/types/map";
import { MAX_VIEWPORT_RENDER_FEATURES } from "@/core/constants/mapConstants";
import type { MapInteractionOptions } from "@/ui-kit/types/map";
import { useMapInstance } from "./map/useMapInstance";
import { useBasemapTileLayer } from "./map/useBasemapTileLayer";
import { useViewportFeatureWindow } from "./map/useViewportFeatureWindow";
import { useVectorChunkStream } from "./map/useVectorChunkStream";
import { useFeatureHighlight } from "./map/useFeatureHighlight";
import { useLayerSymbology } from "./map/useLayerSymbology";
import { useBackgroundClick } from "./map/useBackgroundClick";

export function useLeafletMap(
  mapContainerNode: HTMLDivElement | null,
  geojson: FeatureCollection,
  basemapKey: string,
  featureStyle: MapFeatureStyle,
  selectedFeatureIndex?: number | null,
  onSelectFeature?: (index: number | null) => void,
  isVisible: boolean = true,
  maxRenderFeatures: number | null = MAX_VIEWPORT_RENDER_FEATURES,
  interaction: MapInteractionOptions = {}
): {
  renderedCount: number;
  isChunking: boolean;
  renderError: Error | null;
  handleFitBounds: () => void;
} {
  // 1. Initialize Map Instance, Canvas Renderer, and Ready Flag
  const { mapInstanceRef, canvasRendererRef, isMapReady } = useMapInstance(mapContainerNode);

  // 2. Manage Active Basemap Tile Layer
  useBasemapTileLayer(mapInstanceRef, basemapKey, isMapReady);

  // 3. Dynamic Viewport Windowing
  const windowedGeojson = useViewportFeatureWindow(
    mapInstanceRef,
    geojson,
    isMapReady,
    maxRenderFeatures,
    isVisible
  );

  // 4. Stream Vector GeoJSON Features via Micro-Batches (Visibility-Aware)
  const { renderedCount, isChunking, renderError, featureGroupRef } = useVectorChunkStream(
    mapInstanceRef,
    canvasRendererRef,
    geojson,
    windowedGeojson,
    featureStyle,
    onSelectFeature,
    isMapReady,
    isVisible,
    interaction
  );

  // 4. Highlight Selected Feature & Pan Camera
  useFeatureHighlight(mapInstanceRef, geojson, selectedFeatureIndex, isMapReady, interaction.showPopups !== false, interaction.codedLabels === true);

  useBackgroundClick(
    mapInstanceRef,
    isMapReady,
    interaction.clearOnBackgroundClick === true && onSelectFeature !== undefined ? () => onSelectFeature(null) : undefined
  );

  // 5. Apply Dynamic Layer Symbology Updates (60fps)
  useLayerSymbology(featureGroupRef, featureStyle);

  // 6. Camera View Fit Bounds Action
  const handleFitBounds = () => {
    const mapInstance = mapInstanceRef.current;
    if (mapInstance && featureGroupRef.current) {
      mapInstance.invalidateSize();
      const bounds = featureGroupRef.current.getBounds();
      if (bounds.isValid()) {
        mapInstance.fitBounds(bounds, { padding: [30, 30] });
      }
    }
  };

  return {
    renderedCount,
    isChunking,
    renderError,
    handleFitBounds,
  };
}
