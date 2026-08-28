import type { FeatureCollection } from "geojson";
import type { MapFeatureStyle } from "@/types/map";
import { useMapInstance } from "./map/useMapInstance";
import { useBasemapTileLayer } from "./map/useBasemapTileLayer";
import { useVectorChunkStream } from "./map/useVectorChunkStream";
import { useFeatureHighlight } from "./map/useFeatureHighlight";
import { useLayerSymbology } from "./map/useLayerSymbology";

export function useLeafletMap(
  mapContainerNode: HTMLDivElement | null,
  geojson: FeatureCollection,
  basemapKey: string,
  featureStyle: MapFeatureStyle,
  selectedFeatureIndex?: number | null,
  onSelectFeature?: (index: number | null) => void
): {
  renderedCount: number;
  isChunking: boolean;
  handleFitBounds: () => void;
} {
  // 1. Initialize Map Instance, Canvas Renderer, and Ready Flag
  const { mapInstanceRef, canvasRendererRef, isMapReady } = useMapInstance(mapContainerNode);

  // 2. Manage Active Basemap Tile Layer
  useBasemapTileLayer(mapInstanceRef, basemapKey, isMapReady);

  // 3. Stream Vector GeoJSON Features via Web Worker
  const { renderedCount, isChunking, featureGroupRef } = useVectorChunkStream(
    mapInstanceRef,
    canvasRendererRef,
    geojson,
    featureStyle,
    onSelectFeature,
    isMapReady
  );

  // 4. Highlight Selected Feature & Pan Camera
  useFeatureHighlight(mapInstanceRef, geojson, selectedFeatureIndex, isMapReady);

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
    handleFitBounds,
  };
}
