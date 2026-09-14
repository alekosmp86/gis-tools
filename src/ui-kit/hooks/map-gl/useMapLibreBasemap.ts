import { useEffect } from "react";
import type { Map, StyleSpecification } from "maplibre-gl";
import { BASEMAP_TILES } from "@/core/constants/mapConstants";

function buildRasterTileUrls(url: string, subdomains?: string): string[] {
  if (subdomains && url.includes("{s}")) {
    return subdomains.split("").map((subdomain) =>
      url.replace("{s}", subdomain).replace("{r}", "")
    );
  }
  return [url.replace("{r}", "")];
}

export function buildMapLibreRasterStyle(basemapKey: string): StyleSpecification {
  const tileConfig = BASEMAP_TILES[basemapKey] || BASEMAP_TILES.osm;
  const tileUrls = buildRasterTileUrls(tileConfig.url, tileConfig.subdomains);

  return {
    version: 8,
    sources: {
      "raster-basemap-source": {
        type: "raster",
        tiles: tileUrls,
        tileSize: 256,
        attribution: tileConfig.attribution,
        maxzoom: tileConfig.maxZoom,
      },
    },
    layers: [
      {
        id: "raster-basemap-layer",
        type: "raster",
        source: "raster-basemap-source",
        minzoom: 0,
        maxzoom: 22,
      },
    ],
  };
}

export function useMapLibreBasemap(
  mapInstanceRef: React.RefObject<Map | null>,
  basemapKey: string,
  isMapReady: boolean
): void {
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !isMapReady) return;

    const style = buildMapLibreRasterStyle(basemapKey);
    map.setStyle(style, { diff: true });
  }, [mapInstanceRef, basemapKey, isMapReady]);
}
