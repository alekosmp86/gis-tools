import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { FeatureCollection } from "geojson";
import {
  getDiscrepancyColor,
  getDashArrayFromPattern,
  MAP_MICRO_CHUNK_SIZE,
  MAP_CHUNK_DELAY_MS,
} from "@/constants/mapConstants";
import type { MapFeatureStyle } from "@/types/map";
import { MapChunkMessageType } from "@/types/workerMessages";
import type { MapChunkOutputMessage } from "@/types/workerMessages";
import { buildPopupHtml } from "@/utils/mapPopupBuilder";

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
        const dashArray = getDashArrayFromPattern(currentStyle.strokePattern);
        const canvasRenderer = canvasRendererRef.current;

        const geojsonSubLayer = L.geoJSON(chunkCollection as import("geojson").GeoJsonObject, {
          style: (feature) => {
            const discrepancyType = feature?.properties?._discrepancyType;
            const useDiscrepancyColor = Boolean(discrepancyType && !currentStyle.overrideDiscrepancyColors);
            const strokeColor = useDiscrepancyColor ? getDiscrepancyColor(discrepancyType) : currentStyle.color;
            const fillColor = useDiscrepancyColor
              ? getDiscrepancyColor(discrepancyType)
              : currentStyle.fillColor || currentStyle.color;

            return {
              renderer: canvasRenderer ?? undefined,
              color: strokeColor,
              weight: currentStyle.weight,
              opacity: currentStyle.opacity,
              fillColor,
              fillOpacity: currentStyle.fillOpacity,
              dashArray,
            };
          },
          pointToLayer: (feature, latlng) => {
            const discrepancyType = feature?.properties?._discrepancyType;
            const useDiscrepancyColor = Boolean(discrepancyType && !currentStyle.overrideDiscrepancyColors);
            const strokeColor = useDiscrepancyColor ? getDiscrepancyColor(discrepancyType) : currentStyle.color;
            const fillColor = useDiscrepancyColor
              ? getDiscrepancyColor(discrepancyType)
              : currentStyle.fillColor || currentStyle.color;

            return L.circleMarker(latlng, {
              renderer: canvasRenderer ?? undefined,
              radius: currentStyle.pointRadius,
              fillColor,
              color: useDiscrepancyColor ? "#ffffff" : strokeColor,
              weight: Math.min(currentStyle.weight, 3),
              opacity: currentStyle.opacity,
              fillOpacity: Math.max(currentStyle.fillOpacity, 0.7),
            });
          },
          onEachFeature: (feature, layer) => {
            layer.on("click", () => {
              const popupHtml = buildPopupHtml(feature);
              if (popupHtml) {
                layer.bindPopup(popupHtml, {
                  closeButton: true,
                  autoPan: true,
                  maxWidth: 310,
                }).openPopup();
              }
              if (onSelectFeature) {
                const targetIndex = typeof feature?.properties?._featureIndex === "number"
                  ? feature.properties._featureIndex
                  : geojson.features.indexOf(feature);
                if (targetIndex !== -1 && targetIndex !== undefined) {
                  onSelectFeature(targetIndex);
                }
              }
            });
          },
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
