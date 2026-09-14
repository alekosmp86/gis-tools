import { useEffect, useRef, useState } from "react";
import { Map, NavigationControl, type IControl, type StyleSpecification } from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import "maplibre-gl/dist/maplibre-gl.css";

const INITIAL_EMPTY_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [],
};

export function useDeckMapInstance(mapContainerNode: HTMLDivElement | null): {
  mapInstanceRef: React.RefObject<Map | null>;
  deckOverlayRef: React.RefObject<MapboxOverlay | null>;
  isMapReady: boolean;
} {
  const mapInstanceRef = useRef<Map | null>(null);
  const deckOverlayRef = useRef<MapboxOverlay | null>(null);
  const [isMapReady, setIsMapReady] = useState<boolean>(false);

  useEffect(() => {
    if (!mapContainerNode) return;

    let map: Map | null = null;
    let writeCenterAttributes: (() => void) | null = null;

    if (!mapInstanceRef.current) {
      map = new Map({
        container: mapContainerNode,
        style: INITIAL_EMPTY_STYLE,
        center: [-56.0, -32.5],
        zoom: 6,
        attributionControl: false,
      });

      const navControl = new NavigationControl({ showCompass: false });
      map.addControl(navControl, "bottom-right");

      const overlay = new MapboxOverlay({
        interleaved: false,
        layers: [],
      });
      map.addControl(overlay as unknown as IControl);

      mapInstanceRef.current = map;
      deckOverlayRef.current = overlay;

      writeCenterAttributes = () => {
        const center = map!.getCenter();
        const container = map!.getContainer();
        container.dataset.centerLat = String(center.lat);
        container.dataset.centerLng = String(center.lng);
      };
      writeCenterAttributes();
      map.on("moveend", writeCenterAttributes);

      const handleLoad = () => {
        setIsMapReady(true);
      };
      map.once("load", handleLoad);
    }

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        if (
          mapInstanceRef.current &&
          mapContainerNode.offsetWidth > 0 &&
          mapContainerNode.offsetHeight > 0
        ) {
          mapInstanceRef.current.resize();
        }
      });
      resizeObserver.observe(mapContainerNode);
    }

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (map && writeCenterAttributes) {
        map.off("moveend", writeCenterAttributes);
      }
      if (deckOverlayRef.current && map) {
        try {
          map.removeControl(deckOverlayRef.current as unknown as IControl);
          deckOverlayRef.current.finalize();
        } catch {
          // Safe disposal
        }
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        deckOverlayRef.current = null;
        setIsMapReady(false);
      }
    };
  }, [mapContainerNode]);

  return {
    mapInstanceRef,
    deckOverlayRef,
    isMapReady,
  };
}
