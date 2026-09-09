import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { FeatureCollection, GeoJsonObject } from "geojson";
import { MAP_MICRO_CHUNK_SIZE, MAP_FRAME_BUDGET_MS } from "@/core/constants/mapConstants";
import type { MapFeatureStyle } from "@/core/types/map";
import { createStyleResolver } from "@/ui-kit/map/MapSymbologyStyler";
import { bindGroupFeatureEvents } from "@/ui-kit/map/MapEventHandler";

export function useVectorChunkStream(
  mapInstanceRef: React.RefObject<L.Map | null>,
  canvasRendererRef: React.RefObject<L.Canvas | null>,
  geojson: FeatureCollection,
  featureStyle: MapFeatureStyle,
  onSelectFeature?: (index: number | null) => void,
  isMapReady: boolean = false,
  isVisible: boolean = true
): {
  renderedCount: number;
  isChunking: boolean;
  featureGroupRef: React.RefObject<L.FeatureGroup | null>;
} {
  const featureGroupRef = useRef<L.FeatureGroup | null>(null);
  const lastProcessedGeojsonRef = useRef<FeatureCollection | null>(null);
  const featureStyleRef = useRef(featureStyle);

  useEffect(() => {
    featureStyleRef.current = featureStyle;
  }, [featureStyle]);

  // Selection is a callback, not an input to rendering. Keeping it in a ref stops a click from
  // invalidating the effect and tearing down every rendered layer.
  const onSelectFeatureRef = useRef(onSelectFeature);

  useEffect(() => {
    onSelectFeatureRef.current = onSelectFeature;
  }, [onSelectFeature]);

  const [renderedCount, setRenderedCount] = useState<number>(0);
  const [isChunking, setIsChunking] = useState<boolean>(false);

  useEffect(() => {
    const mapInstance = mapInstanceRef.current;
    if (!mapInstance || !isMapReady) return;

    // If the map is currently hidden, defer rendering until it becomes visible
    if (!isVisible) {
      return;
    }

    // If already rendered this exact geojson collection and visible, ensure viewport is fitted
    // Re-fit only when this collection is already rendered AND still attached. Without the
    // attachment check, any dependency change would run cleanup (which detaches the group) and
    // then short-circuit here, leaving the map empty.
    const isAlreadyRendered =
      lastProcessedGeojsonRef.current === geojson &&
      featureGroupRef.current !== null &&
      mapInstance.hasLayer(featureGroupRef.current);

    if (isAlreadyRendered) {
      mapInstance.invalidateSize();
      if (featureGroupRef.current) {
        const bounds = featureGroupRef.current.getBounds();
        if (bounds.isValid()) {
          mapInstance.fitBounds(bounds, { padding: [30, 30] });
        }
      }
      return;
    }

    lastProcessedGeojsonRef.current = geojson;

    if (featureGroupRef.current) {
      mapInstance.removeLayer(featureGroupRef.current);
    }

    const featureGroup = L.featureGroup().addTo(mapInstance);
    featureGroupRef.current = featureGroup;

    // One delegated listener for the whole group instead of one per rendered feature.
    bindGroupFeatureEvents(featureGroup, geojson?.features ?? [], (featureIndex) =>
      onSelectFeatureRef.current?.(featureIndex)
    );

    let isCancelled = false;
    const totalFeatures = geojson?.features?.length || 0;

    if (totalFeatures === 0) {
      requestAnimationFrame(() => {
        if (!isCancelled) {
          setRenderedCount(0);
          setIsChunking(false);
        }
      });
      return;
    }

    let initialZoomDone = false;
    let scheduledFrame: number | null = null;
    let renderedOffset = 0;

    mapInstance.invalidateSize();

    const fitToRenderedFeatures = () => {
      mapInstance.invalidateSize();
      const bounds = featureGroup.getBounds();
      if (bounds.isValid()) {
        mapInstance.fitBounds(bounds, { padding: [30, 30] });
      }
    };

    /**
     * Renders one micro-batch straight from the source collection. Slicing yields references to the
     * original features, so no feature object is copied on the way to Leaflet.
     */
    const renderOneChunk = () => {
      const chunkFeatures = geojson.features.slice(
        renderedOffset,
        renderedOffset + MAP_MICRO_CHUNK_SIZE
      );
      renderedOffset += chunkFeatures.length;

      const styleResolver = createStyleResolver(
        featureStyleRef.current,
        canvasRendererRef.current
      );

      const chunkCollection: FeatureCollection = {
        type: "FeatureCollection",
        features: chunkFeatures,
      };

      const geojsonSubLayer = L.geoJSON(chunkCollection as GeoJsonObject, {
        style: (feature) => styleResolver.resolvePathStyle(feature),
        pointToLayer: (feature, latlng) => styleResolver.createPointLayer(feature, latlng),
      });

      featureGroup.addLayer(geojsonSubLayer);

      if (!initialZoomDone) {
        initialZoomDone = true;
        fitToRenderedFeatures();
      }
    };

    /**
     * Renders as many chunks as fit in the frame budget, then yields.
     *
     * Rendering exactly one chunk per frame caps throughput at roughly 400 features per 16ms, which
     * makes a large collection take seconds to finish. Spending a bounded slice of each frame keeps
     * the page responsive while letting fast machines finish far sooner.
     */
    const renderChunksWithinFrameBudget = () => {
      if (isCancelled) return;

      const frameStart = performance.now();

      do {
        renderOneChunk();
      } while (
        !isCancelled &&
        renderedOffset < totalFeatures &&
        performance.now() - frameStart < MAP_FRAME_BUDGET_MS
      );

      if (isCancelled) return;

      const isComplete = renderedOffset >= totalFeatures;
      setRenderedCount(renderedOffset);
      setIsChunking(!isComplete);

      if (isComplete) {
        // Final bounds fit once every chunk is painted
        fitToRenderedFeatures();
        return;
      }

      scheduledFrame = requestAnimationFrame(renderChunksWithinFrameBudget);
    };

    renderChunksWithinFrameBudget();

    return () => {
      isCancelled = true;
      if (scheduledFrame !== null) {
        cancelAnimationFrame(scheduledFrame);
      }
      try {
        featureGroup.clearLayers();
        if (mapInstance.hasLayer(featureGroup)) {
          mapInstance.removeLayer(featureGroup);
        }
      } catch {
        // Safe disposal
      }
    };
  }, [mapInstanceRef, canvasRendererRef, geojson, isMapReady, isVisible]);

  return {
    renderedCount,
    isChunking,
    featureGroupRef,
  };
}
