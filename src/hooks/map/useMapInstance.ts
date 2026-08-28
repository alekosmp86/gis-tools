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

      const canvasRenderer = L.canvas({ padding: 0.5 });

      mapInstanceRef.current = map;
      canvasRendererRef.current = canvasRenderer;
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

  return {
    mapInstanceRef,
    canvasRendererRef,
    isMapReady,
  };
}
