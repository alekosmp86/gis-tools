import { useEffect, useRef, useState } from "react";
import L from "leaflet";

export function useMapInstance(mapContainerNode: HTMLDivElement | null): {
  mapInstanceRef: React.RefObject<L.Map | null>;
  canvasRendererRef: React.RefObject<L.Canvas | null>;
  isMapReady: boolean;
} {
  const mapInstanceRef = useRef<L.Map | null>(null);
  const canvasRendererRef = useRef<L.Canvas | null>(null);
  const [isMapReady, setIsMapReady] = useState<boolean>(false);

  useEffect(() => {
    if (!mapContainerNode) return;

    let map: L.Map | null = null;
    let writeCenterAttributes: (() => void) | null = null;

    if (!mapInstanceRef.current) {
      map = L.map(mapContainerNode, {
        zoomControl: false,
        attributionControl: false,
      }).setView([-32.5, -56.0], 7);

      L.control.zoom({ position: "bottomright" }).addTo(map);

      const canvasRenderer = L.canvas({ padding: 0.5 });

      mapInstanceRef.current = map;
      canvasRendererRef.current = canvasRenderer;

      writeCenterAttributes = () => {
        const center = map!.getCenter();
        const container = map!.getContainer();
        container.dataset.centerLat = String(center.lat);
        container.dataset.centerLng = String(center.lng);
      };
      writeCenterAttributes();
      map.on("moveend", writeCenterAttributes);

      setIsMapReady(true);
    }

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        if (mapInstanceRef.current && mapContainerNode.offsetWidth > 0 && mapContainerNode.offsetHeight > 0) {
          mapInstanceRef.current.invalidateSize();
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
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        canvasRendererRef.current = null;
        setIsMapReady(false);
      }
    };
  }, [mapContainerNode]);

  return {
    mapInstanceRef,
    canvasRendererRef,
    isMapReady,
  };
}
