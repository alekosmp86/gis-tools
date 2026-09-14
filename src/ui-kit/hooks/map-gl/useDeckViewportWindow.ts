import { useEffect, useRef, useState } from "react";
import type { Map, LngLatBounds } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import type { BBox } from "@/core/types/map";
import { VIEWPORT_INDEX_PADDING_RATIO } from "@/core/constants/mapConstants";
import { ViewportFeatureIndex } from "@/core/spatial/ViewportFeatureIndex";
import { planViewportWindow } from "@/core/spatial/ViewportWindowPlanner";

function lngLatBoundsToBBox(bounds: LngLatBounds): BBox {
  return [
    bounds.getWest(),
    bounds.getSouth(),
    bounds.getEast(),
    bounds.getNorth(),
  ];
}

const INITIAL_WINDOWED_COLLECTION: FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/**
 * Adapter hook that manages a spatial index over the full GeoJSON dataset and provides
 * a viewport-windowed FeatureCollection subset to deck.gl WebGL layers.
 */
export function useDeckViewportWindow(
  mapInstanceRef: React.RefObject<Map | null>,
  geojson: FeatureCollection,
  isMapReady: boolean = false,
  maxRenderFeatures: number | null = null,
  isVisible: boolean = true
): FeatureCollection {
  const indexRef = useRef<ViewportFeatureIndex | null>(null);
  const lastProcessedGeojsonRef = useRef<FeatureCollection | null>(null);
  const previousWindowBBoxRef = useRef<BBox | null>(null);
  const windowedCollectionRef = useRef<FeatureCollection>(INITIAL_WINDOWED_COLLECTION);

  const [windowedCollection, setWindowedCollection] = useState<FeatureCollection>(
    INITIAL_WINDOWED_COLLECTION
  );

  useEffect(() => {
    const mapInstance = mapInstanceRef.current;
    if (!mapInstance || !isMapReady || !isVisible) {
      return;
    }

    // Build ViewportFeatureIndex once per full-geojson identity change
    if (lastProcessedGeojsonRef.current !== geojson) {
      lastProcessedGeojsonRef.current = geojson;
      const features = geojson?.features ?? [];
      const newIndex = new ViewportFeatureIndex(features);
      indexRef.current = newIndex;
      previousWindowBBoxRef.current = null;

      const collectionBBox = newIndex.getCollectionBBox();
      if (collectionBBox) {
        mapInstance.fitBounds(
          [
            [collectionBBox[0], collectionBBox[1]],
            [collectionBBox[2], collectionBBox[3]],
          ],
          { padding: 30 }
        );
      }
    }

    const currentIndex = indexRef.current;
    if (!currentIndex) {
      return;
    }

    const updateWindow = () => {
      const activeMap = mapInstanceRef.current;
      if (!activeMap) {
        return;
      }

      const bounds = activeMap.getBounds();
      if (bounds.isEmpty()) {
        return;
      }

      const viewportBBox = lngLatBoundsToBBox(bounds);
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
      mapInstance.off("moveend", updateWindow);
      mapInstance.off("zoomend", updateWindow);
    };
  }, [mapInstanceRef, geojson, isMapReady, maxRenderFeatures, isVisible]);

  return windowedCollection;
}
