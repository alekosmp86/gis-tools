import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { FeatureCollection } from "geojson";
import {
  BASEMAP_TILES,
  getDiscrepancyColor,
  MAP_MICRO_CHUNK_SIZE,
  MAP_CHUNK_DELAY_MS,
} from "@/constants/mapConstants";
import { MapChunkMessageType } from "@/types/workerMessages";
import type { MapChunkOutputMessage } from "@/types/workerMessages";
import { buildPopupHtml } from "@/utils/mapPopupBuilder";

export function useLeafletMap(
  mapContainerRef: React.RefObject<HTMLDivElement | null>,
  geojson: FeatureCollection,
  basemapKey: string
): {
  renderedCount: number;
  isChunking: boolean;
  handleFitBounds: () => void;
} {
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const featureGroupRef = useRef<L.FeatureGroup | null>(null);
  const lastProcessedGeojsonRef = useRef<FeatureCollection | null>(null);

  const [renderedCount, setRenderedCount] = useState<number>(0);
  const [isChunking, setIsChunking] = useState<boolean>(false);

  // 1. Initialize Map Instance and Basemap Tile Layer
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: false,
      }).setView([-32.5, -56.0], 7); // Center of Uruguay

      L.control.zoom({ position: "bottomright" }).addTo(map);
      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;

    // Swap Basemap tile layer without affecting vector feature layers
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const tileConfig = BASEMAP_TILES[basemapKey] || BASEMAP_TILES.voyager;
    const tileLayer = L.tileLayer(tileConfig.url, {
      maxZoom: tileConfig.maxZoom,
      subdomains: tileConfig.subdomains || "abc",
    }).addTo(map);
    tileLayerRef.current = tileLayer;
  }, [mapContainerRef, basemapKey]);

  // 2. Stream Vector GeoJSON Features via Web Worker (only re-runs when geojson features actually change)
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    // Prevent re-streaming if geojson reference, features array, or feature items haven't changed
    const prevFeatures = lastProcessedGeojsonRef.current?.features;
    const nextFeatures = geojson?.features;

    if (
      lastProcessedGeojsonRef.current === geojson ||
      prevFeatures === nextFeatures ||
      (prevFeatures &&
        nextFeatures &&
        prevFeatures.length === nextFeatures.length &&
        (nextFeatures.length === 0 || prevFeatures[0] === nextFeatures[0]))
    ) {
      return;
    }
    lastProcessedGeojsonRef.current = geojson;

    // Reset Vector Layer Group
    if (featureGroupRef.current) {
      map.removeLayer(featureGroupRef.current);
    }

    const featureGroup = L.featureGroup().addTo(map);
    featureGroupRef.current = featureGroup;

    if (!geojson || !geojson.features || geojson.features.length === 0) {
      return;
    }

    let isCancelled = false;
    let initialZoomDone = false;
    let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

    // Instantiate Web Worker for off-main-thread GeoJSON chunking
    const worker = new Worker(new URL("../workers/mapChunkWorker.ts", import.meta.url));

    worker.onmessage = (event: MessageEvent<MapChunkOutputMessage>) => {
      if (isCancelled) return;
      const { type, payload } = event.data;

      if (type === MapChunkMessageType.CHUNK_BATCH && payload.chunk) {
        const chunkCollection: FeatureCollection = {
          type: "FeatureCollection",
          features: payload.chunk,
        };

        const geojsonSubLayer = L.geoJSON(chunkCollection as import("geojson").GeoJsonObject, {
          style: (feature) => {
            const discType = feature?.properties?._discrepancyType;
            const color = getDiscrepancyColor(discType);
            return {
              color,
              weight: 4.5,
              opacity: 0.9,
            };
          },
          pointToLayer: (feature, latlng) => {
            const discType = feature?.properties?._discrepancyType;
            const color = getDiscrepancyColor(discType);
            return L.circleMarker(latlng, {
              radius: 7,
              fillColor: color,
              color: "#ffffff",
              weight: 2,
              opacity: 1,
              fillOpacity: 0.9,
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
              const bounds = featureGroup.getBounds();
              if (bounds.isValid()) {
                map.fitBounds(bounds, { padding: [30, 30] });
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
  }, [geojson]);

  const handleFitBounds = () => {
    if (mapInstanceRef.current && featureGroupRef.current) {
      const bounds = featureGroupRef.current.getBounds();
      if (bounds.isValid()) {
        mapInstanceRef.current.fitBounds(bounds, { padding: [30, 30] });
      }
    }
  };

  return {
    renderedCount,
    isChunking,
    handleFitBounds,
  };
}
