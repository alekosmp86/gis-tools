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

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerNode, {
        zoomControl: false,
        attributionControl: false,
      }).setView([-32.5, -56.0], 7);

      L.control.zoom({ position: "bottomright" }).addTo(map);

      mapInstanceRef.current = map;
      canvasRendererRef.current = L.canvas({ padding: 0.5 });

      setIsMapReady(true);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        canvasRendererRef.current = null;
        setIsMapReady(false);
      }
    };
  }, [mapContainerNode]);

  useEffect(() => {
    if (!mapContainerNode || typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(() => {
      if (mapInstanceRef.current && mapContainerNode.offsetWidth > 0 && mapContainerNode.offsetHeight > 0) {
        mapInstanceRef.current.invalidateSize();
      }
    });
    resizeObserver.observe(mapContainerNode);

    return () => {
      resizeObserver.disconnect();
    };
  }, [mapContainerNode]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!isMapReady || !map) return;

    const writeCenterAttributes = () => {
      const center = map.getCenter();
      const container = map.getContainer();
      container.dataset.centerLat = String(center.lat);
      container.dataset.centerLng = String(center.lng);
    };
    writeCenterAttributes();
    map.on("moveend", writeCenterAttributes);

    return () => {
      map.off("moveend", writeCenterAttributes);
    };
  }, [isMapReady, mapContainerNode]);

  return {
    mapInstanceRef,
    canvasRendererRef,
    isMapReady,
  };
}
