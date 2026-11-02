import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { FeatureCollection, GeoJsonObject } from "geojson";
import { MAP_MICRO_CHUNK_SIZE, MAP_FRAME_BUDGET_MS } from "@/core/constants/mapConstants";
import type { MapFeatureStyle } from "@/core/types/map";
import { createStyleResolver } from "@/ui-kit/map/MapSymbologyStyler";
import { bindGroupFeatureEvents } from "@/ui-kit/map/MapEventHandler";
import { bindFeatureLabel } from "@/ui-kit/map/MapFeatureLabel";
import type { MapInteractionOptions } from "@/ui-kit/types/map";

export function useVectorChunkStream(
  mapInstanceRef: React.RefObject<L.Map | null>,
  canvasRendererRef: React.RefObject<L.Canvas | null>,
  geojson: FeatureCollection,
  windowedGeojson: FeatureCollection,
  featureStyle: MapFeatureStyle,
  onSelectFeature?: (index: number | null) => void,
  isMapReady: boolean = false,
  isVisible: boolean = true,
  interaction: MapInteractionOptions = {}
): {
  renderedCount: number;
  isChunking: boolean;
  renderError: Error | null;
  featureGroupRef: React.RefObject<L.FeatureGroup | null>;
} {
  const featureGroupRef = useRef<L.FeatureGroup | null>(null);
  const lastProcessedWindowRef = useRef<FeatureCollection | null>(null);
  const lastBoundGeojsonRef = useRef<FeatureCollection | null>(null);
  const featureStyleRef = useRef(featureStyle);
  const interactionRef = useRef(interaction);

  const pendingTeardownLayersRef = useRef<L.Layer[]>([]);
  const renderedSubLayersRef = useRef<L.Layer[]>([]);

  useEffect(() => {
    featureStyleRef.current = featureStyle;
  }, [featureStyle]);

  useEffect(() => {
    interactionRef.current = interaction;
  }, [interaction]);

  // Selection is a callback, not an input to rendering. Keeping it in a ref stops a click from
  // invalidating the effect and tearing down every rendered layer.
  const onSelectFeatureRef = useRef(onSelectFeature);

  useEffect(() => {
    onSelectFeatureRef.current = onSelectFeature;
  }, [onSelectFeature]);

  // Clean unmount of featureGroup container without synchronous 50,000-layer recursive traversal
  useEffect(() => {
    const mapInstance = mapInstanceRef.current;
    return () => {
      const featureGroup = featureGroupRef.current;
      if (featureGroup && mapInstance) {
        try {
          (featureGroup as unknown as { _layers: Record<string, unknown> })._layers = {};
          if (mapInstance.hasLayer(featureGroup)) {
            mapInstance.removeLayer(featureGroup);
          }
        } catch {
          // Safe disposal
        }
      }
    };
  }, [mapInstanceRef]);

  const [renderedCount, setRenderedCount] = useState<number>(0);
  const [isChunking, setIsChunking] = useState<boolean>(false);
  const [renderError, setRenderError] = useState<Error | null>(null);

  useEffect(() => {
    const mapInstance = mapInstanceRef.current;
    if (!mapInstance || !isMapReady) return;

    const pendingTeardownLayers = pendingTeardownLayersRef.current;

    // If the map is currently hidden, defer rendering until it becomes visible
    if (!isVisible) {
      return;
    }

    // Ensure persistent featureGroup is initialized and attached
    if (!featureGroupRef.current) {
      featureGroupRef.current = L.featureGroup().addTo(mapInstance);
    } else if (!mapInstance.hasLayer(featureGroupRef.current)) {
      mapInstance.addLayer(featureGroupRef.current);
    }
    const featureGroup = featureGroupRef.current;

    // Delegate click events once per full-dataset identity change
    if (lastBoundGeojsonRef.current !== geojson) {
      lastBoundGeojsonRef.current = geojson;
      bindGroupFeatureEvents(
        featureGroup,
        geojson?.features ?? [],
        (featureIndex) => onSelectFeatureRef.current?.(featureIndex),
        interactionRef.current.showPopups !== false
      );
    }

    // If already rendered this exact windowed collection and visible, ensure size is valid
    const isAlreadyRendered =
      lastProcessedWindowRef.current === windowedGeojson &&
      mapInstance.hasLayer(featureGroup);

    if (isAlreadyRendered) {
      mapInstance.invalidateSize();
      return;
    }

    lastProcessedWindowRef.current = windowedGeojson;

    // Queue currently rendered sublayers for frame-budgeted progressive teardown
    if (renderedSubLayersRef.current.length > 0) {
      pendingTeardownLayersRef.current.push(...renderedSubLayersRef.current);
      renderedSubLayersRef.current = [];
    }

    let isCancelled = false;
    const windowedFeatures = windowedGeojson?.features ?? [];
    const totalFeatures = windowedFeatures.length;

    if (totalFeatures === 0 && pendingTeardownLayersRef.current.length === 0) {
      requestAnimationFrame(() => {
        if (!isCancelled) {
          setRenderedCount(0);
          setIsChunking(false);
          setRenderError(null);
        }
      });
      return;
    }

    let scheduledFrame: number | null = null;
    let renderedOffset = 0;

    mapInstance.invalidateSize();
    setIsChunking(true);
    setRenderError(null);

    /**
     * Renders one micro-batch straight from the windowed collection. Slicing yields references to the
     * original features, so no feature object is copied on the way to Leaflet.
     */
    const renderOneChunk = () => {
      const chunkFeatures = windowedFeatures.slice(
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

      const labelProperty = interactionRef.current.labelProperty;
      const geojsonSubLayer = L.geoJSON(chunkCollection as GeoJsonObject, {
        style: (feature) => styleResolver.resolvePathStyle(feature),
        pointToLayer: (feature, latlng) => styleResolver.createPointLayer(feature, latlng),
        onEachFeature:
          labelProperty === undefined
            ? undefined
            : (feature, layer) => bindFeatureLabel(feature.properties, layer, labelProperty),
      });

      featureGroup.addLayer(geojsonSubLayer);
      renderedSubLayersRef.current.push(geojsonSubLayer);
    };

    /**
     * Symmetrically paces both sublayer teardown and new chunk additions within MAP_FRAME_BUDGET_MS,
     * ensuring no individual animation frame blocks the main thread for duration proportional to window size.
     */
    const processChunksWithinFrameBudget = () => {
      if (isCancelled) return;

      const frameStart = performance.now();

      // Phase 1: Progressive teardown of retiring sublayers
      while (
        pendingTeardownLayersRef.current.length > 0 &&
        performance.now() - frameStart < MAP_FRAME_BUDGET_MS
      ) {
        const subLayer = pendingTeardownLayersRef.current.pop();
        if (subLayer && featureGroup.hasLayer(subLayer)) {
          featureGroup.removeLayer(subLayer);
        }
      }

      if (isCancelled) return;

      // If teardown still has layers and frame budget is exhausted, yield to next frame
      if (pendingTeardownLayersRef.current.length > 0) {
        scheduledFrame = requestAnimationFrame(processChunksWithinFrameBudget);
        return;
      }

      // Phase 2: Progressive construction of new windowed chunks. A throw here happens in a frame callback, out of
      // React's reach, so it is reported through state instead of leaving a silently blank map.
      try {
        while (
          renderedOffset < totalFeatures &&
          performance.now() - frameStart < MAP_FRAME_BUDGET_MS
        ) {
          renderOneChunk();
        }
      } catch (error: unknown) {
        console.error("[map] Failed to draw the features.", error);
        setRenderError(error instanceof Error ? error : new Error(String(error)));
        setIsChunking(false);
        return;
      }

      if (isCancelled) return;

      const isComplete = renderedOffset >= totalFeatures;
      setRenderedCount(renderedOffset);
      setIsChunking(!isComplete);

      if (!isComplete) {
        scheduledFrame = requestAnimationFrame(processChunksWithinFrameBudget);
      }
    };

    scheduledFrame = requestAnimationFrame(processChunksWithinFrameBudget);

    return () => {
      isCancelled = true;
      if (scheduledFrame !== null) {
        cancelAnimationFrame(scheduledFrame);
      }
      // Preserve any rendered layers into pending teardown for the next window cycle
      if (renderedSubLayersRef.current.length > 0) {
        pendingTeardownLayers.push(...renderedSubLayersRef.current);
        renderedSubLayersRef.current = [];
      }
    };
  }, [mapInstanceRef, canvasRendererRef, windowedGeojson, geojson, isMapReady, isVisible]);

  return {
    renderedCount,
    isChunking,
    renderError,
    featureGroupRef,
  };
}
