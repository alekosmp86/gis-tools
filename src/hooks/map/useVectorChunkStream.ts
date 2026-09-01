import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { FeatureCollection } from "geojson";
import { MAP_MICRO_CHUNK_SIZE, MAP_CHUNK_DELAY_MS } from "@/constants/mapConstants";
import type { MapFeatureStyle } from "@/types/map";
import { MapChunkMessageType } from "@/types/workerMessages";
import type { MapChunkOutputMessage } from "@/types/workerMessages";
import { computeFeatureStyle, createPointToLayer } from "@/utils/mapFeatureStyler";
import { bindFeatureEvents } from "@/utils/mapFeatureEvents";

export function useVectorChunkStream(
  mapInstanceRef: React.RefObject<L.Map | null>,
  canvasRendererRef: React.RefObject<L.Canvas | null>,
  geojson: FeatureCollection,
  featureStyle: MapFeatureStyle,
  onSelectFeature?: (index: number | null) => void,
  isMapReady: boolean = false
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

  const [renderedCount, setRenderedCount] = useState<number>(0);
  const [isChunking, setIsChunking] = useState<boolean>(false);

  useEffect(() => {
    const mapInstance = mapInstanceRef.current;
    if (!mapInstance || !isMapReady) return;

    if (lastProcessedGeojsonRef.current === geojson) {
      return;
    }
    lastProcessedGeojsonRef.current = geojson;

    if (featureGroupRef.current) {
      mapInstance.removeLayer(featureGroupRef.current);
    }

    const featureGroup = L.featureGroup().addTo(mapInstance);
    featureGroupRef.current = featureGroup;

    if (!geojson?.features || geojson.features.length === 0) {
      return;
    }

    let isCancelled = false;
    let initialZoomDone = false;
    let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

    const worker = new Worker(new URL("../../workers/mapChunkWorker.ts", import.meta.url));

    worker.onmessage = (event: MessageEvent<MapChunkOutputMessage>) => {
      if (isCancelled) return;
      const { type, payload } = event.data;

      if (type === MapChunkMessageType.CHUNK_BATCH && payload.chunk) {
        const chunkCollection: FeatureCollection = {
          type: "FeatureCollection",
          features: payload.chunk,
        };

        const currentStyle = featureStyleRef.current;
        const canvasRenderer = canvasRendererRef.current;

        const geojsonSubLayer = L.geoJSON(chunkCollection as import("geojson").GeoJsonObject, {
          style: (feature) => computeFeatureStyle(feature, currentStyle, canvasRenderer),
          pointToLayer: (feature, latlng) =>
            createPointToLayer(feature, latlng, currentStyle, canvasRenderer),
          onEachFeature: (feature, layer) =>
            bindFeatureEvents(feature, layer, geojson.features, onSelectFeature),
        });

        featureGroup.addLayer(geojsonSubLayer);

        pendingTimeout = setTimeout(() => {
          if (!isCancelled) {
            setRenderedCount(payload.current);
            setIsChunking(payload.current < payload.total);

            if (!initialZoomDone) {
              initialZoomDone = true;
              mapInstance.invalidateSize();
              const bounds = featureGroup.getBounds();
              if (bounds.isValid()) {
                mapInstance.fitBounds(bounds, { padding: [30, 30] });
              }
            }
          }
        }, MAP_CHUNK_DELAY_MS);
      } else if (type === MapChunkMessageType.CHUNK_DONE) {
        if (!isCancelled) {
          setRenderedCount(payload.total);
          setIsChunking(false);
        }
      }
    };

    worker.postMessage({
      type: MapChunkMessageType.CHUNK_GEOJSON,
      payload: {
        features: geojson.features,
        chunkSize: MAP_MICRO_CHUNK_SIZE,
      },
    });

    return () => {
      isCancelled = true;
      if (pendingTimeout !== null) clearTimeout(pendingTimeout);
      worker.terminate();
    };
  }, [mapInstanceRef, canvasRendererRef, geojson, onSelectFeature, isMapReady]);

  return {
    renderedCount,
    isChunking,
    featureGroupRef,
  };
}
