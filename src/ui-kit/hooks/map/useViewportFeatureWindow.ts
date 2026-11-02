import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { FeatureCollection } from "geojson";
import type { BBox } from "@/core/types/map";
import {
  MAX_VIEWPORT_RENDER_FEATURES,
  VIEWPORT_INDEX_PADDING_RATIO,
} from "@/core/constants/mapConstants";
import { ViewportFeatureIndex } from "@/core/spatial/ViewportFeatureIndex";
import { planViewportWindow } from "@/core/spatial/ViewportWindowPlanner";

function latLngBoundsToBBox(bounds: L.LatLngBounds): BBox {
  return [
    bounds.getWest(),
    bounds.getSouth(),
    bounds.getEast(),
    bounds.getNorth(),
  ];
}

const FIT_OPTIONS: L.FitBoundsOptions = { padding: [30, 30] };

function collectionBoundsOf(collectionBBox: BBox | null): L.LatLngBounds | null {
  if (!collectionBBox) return null;
  const bounds = L.latLngBounds([collectionBBox[1], collectionBBox[0]], [collectionBBox[3], collectionBBox[2]]);
  return bounds.isValid() ? bounds : null;
}

function hasArea(map: L.Map): boolean {
  const size = map.getSize();
  return size.x > 0 && size.y > 0;
}

const INITIAL_WINDOWED_COLLECTION: FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/**
 * Adapter hook that manages a spatial index over the full GeoJSON dataset and provides
 * a viewport-windowed FeatureCollection subset to Leaflet renderers.
 */
export function useViewportFeatureWindow(
  mapInstanceRef: React.RefObject<L.Map | null>,
  geojson: FeatureCollection,
  isMapReady: boolean = false,
  maxRenderFeatures: number | null = MAX_VIEWPORT_RENDER_FEATURES,
  isVisible: boolean = true
): FeatureCollection {
  const indexRef = useRef<ViewportFeatureIndex | null>(null);
  const lastProcessedGeojsonRef = useRef<FeatureCollection | null>(null);
  const previousWindowBBoxRef = useRef<BBox | null>(null);
  const pendingFitBoundsRef = useRef<L.LatLngBounds | null>(null);

  const windowedCollectionRef = useRef<FeatureCollection>(INITIAL_WINDOWED_COLLECTION);

  const [windowedCollection, setWindowedCollection] = useState<FeatureCollection>(
    INITIAL_WINDOWED_COLLECTION
  );

  useEffect(() => {
    const mapInstance = mapInstanceRef.current;
    if (!mapInstance || !isMapReady || !isVisible) {
      return;
    }

    mapInstance.invalidateSize();

    // Build ViewportFeatureIndex once per full-geojson identity change
    if (lastProcessedGeojsonRef.current !== geojson) {
      lastProcessedGeojsonRef.current = geojson;
      const features = geojson?.features ?? [];
      const newIndex = new ViewportFeatureIndex(features);
      indexRef.current = newIndex;
      previousWindowBBoxRef.current = null;
      pendingFitBoundsRef.current = collectionBoundsOf(newIndex.getCollectionBBox());
    }

    // A fit on a container without size zooms out to the world, so the fit waits for the first resize with a size.
    const fitPendingBounds = () => {
      const bounds = pendingFitBoundsRef.current;
      if (bounds === null || !hasArea(mapInstance)) return;
      pendingFitBoundsRef.current = null;
      mapInstance.fitBounds(bounds, FIT_OPTIONS);
    };
    fitPendingBounds();
    mapInstance.on("resize", fitPendingBounds);

    const currentIndex = indexRef.current;
    if (!currentIndex) {
      return () => {
        mapInstance.off("resize", fitPendingBounds);
      };
    }

    const updateWindow = () => {
      const activeMap = mapInstanceRef.current;
      if (!activeMap) {
        return;
      }

      activeMap.invalidateSize();

      const bounds = activeMap.getBounds();
      if (!bounds.isValid()) {
        return;
      }

      const viewportBBox = latLngBoundsToBBox(bounds);
      const plan = planViewportWindow(
        currentIndex,
        geojson?.features ?? [],
        viewportBBox,
        previousWindowBBoxRef.current,
        {
          paddingRatio: VIEWPORT_INDEX_PADDING_RATIO,
          maxRenderFeatures,
          previousWindowFeatures: windowedCollectionRef.current.features,
        }
      );

      if (!plan.shouldRebuild) {
        return;
      }

      previousWindowBBoxRef.current = plan.newWindowBBox;
      const nextCollection: FeatureCollection = {
        type: "FeatureCollection",
        features: plan.windowedFeatures,
      };

      windowedCollectionRef.current = nextCollection;
      setWindowedCollection(nextCollection);
    };

    // Eager calculation on initial setup
    updateWindow();

    mapInstance.on("moveend", updateWindow);
    mapInstance.on("zoomend", updateWindow);

    return () => {
      mapInstance.off("resize", fitPendingBounds);
      mapInstance.off("moveend", updateWindow);
      mapInstance.off("zoomend", updateWindow);
    };
  }, [mapInstanceRef, geojson, isMapReady, maxRenderFeatures, isVisible]);

  return windowedCollection;
}
