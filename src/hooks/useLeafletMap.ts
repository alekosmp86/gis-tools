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
  mapContainerNode: HTMLDivElement | null,
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
  const canvasRendererRef = useRef<L.Canvas | null>(null);

  const basemapKeyRef = useRef(basemapKey);
  useEffect(() => {
    basemapKeyRef.current = basemapKey;
  }, [basemapKey]);

  const [renderedCount, setRenderedCount] = useState<number>(0);
  const [isChunking, setIsChunking] = useState<boolean>(false);

  // 1. Initialize Map Instance and Basemap Tile Layer
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const tileConfig = BASEMAP_TILES[basemapKey] || BASEMAP_TILES.voyager;
    const tileLayer = L.tileLayer(tileConfig.url, {
      maxZoom: tileConfig.maxZoom,
      subdomains: tileConfig.subdomains || "abc",
    }).addTo(map);
    tileLayerRef.current = tileLayer;
  }, [basemapKey]);

  // 2. Stream Vector GeoJSON Features via Web Worker (only re-runs when geojson features actually change)
  useEffect(() => {
    if (!mapContainerNode) return;

    // ── Step 1: Create map when container DOM node is mounted ────────────
    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerNode, {
        zoomControl: false,
        attributionControl: false,
      }).setView([-32.5, -56.0], 7);

      L.control.zoom({ position: "bottomright" }).addTo(map);
      mapInstanceRef.current = map;
      canvasRendererRef.current = L.canvas({ padding: 0.5 });

      // Add initial tile layer
      const tileConfig = BASEMAP_TILES[basemapKeyRef.current] || BASEMAP_TILES.voyager;
      const tileLayer = L.tileLayer(tileConfig.url, {
        maxZoom: tileConfig.maxZoom,
        subdomains: tileConfig.subdomains || "abc",
      }).addTo(map);
      tileLayerRef.current = tileLayer;
    }

    const map = mapInstanceRef.current;

    // ── Step 2: Skip if same GeoJSON reference ────────────────────────────
    if (lastProcessedGeojsonRef.current === geojson) {
      return;
    }
    lastProcessedGeojsonRef.current = geojson;

    // ── Step 3: Clear previous vector features ────────────────────────────
    if (featureGroupRef.current) {
      map.removeLayer(featureGroupRef.current);
    }

    const featureGroup = L.featureGroup().addTo(map);
    featureGroupRef.current = featureGroup;

    if (!geojson?.features || geojson.features.length === 0) {
      return;
    }

    // ── Step 4: Stream features via Web Worker ────────────────────────────
    let isCancelled = false;
    let initialZoomDone = false;
    let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

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
              renderer: canvasRendererRef.current ?? undefined,
              color,
              weight: 4.5,
              opacity: 0.9,
              fillColor: color,
              fillOpacity: 0.35,
            };
          },
          pointToLayer: (feature, latlng) => {
            const discType = feature?.properties?._discrepancyType;
            const color = getDiscrepancyColor(discType);
            return L.circleMarker(latlng, {
              renderer: canvasRendererRef.current ?? undefined,
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
              map.invalidateSize();
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
  }, [mapContainerNode, geojson]);

  const handleFitBounds = () => {
    if (mapInstanceRef.current && featureGroupRef.current) {
      mapInstanceRef.current.invalidateSize();
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
