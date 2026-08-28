import { useEffect, useRef } from "react";
import L from "leaflet";
import { BASEMAP_TILES } from "@/constants/mapConstants";

export function useBasemapTileLayer(
  mapInstanceRef: React.RefObject<L.Map | null>,
  basemapKey: string,
  isMapReady: boolean
): void {
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !isMapReady) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const tileConfig = BASEMAP_TILES[basemapKey] || BASEMAP_TILES.osm;
    const tileLayer = L.tileLayer(tileConfig.url, {
      maxZoom: tileConfig.maxZoom,
      subdomains: tileConfig.subdomains || "abc",
    }).addTo(map);

    tileLayerRef.current = tileLayer;

    return () => {
      if (tileLayerRef.current && map) {
        map.removeLayer(tileLayerRef.current);
        tileLayerRef.current = null;
      }
    };
  }, [mapInstanceRef, basemapKey, isMapReady]);
}
