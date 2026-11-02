import { useEffect, useRef } from "react";
import L from "leaflet";

export function useBackgroundClick(
  mapInstanceRef: React.RefObject<L.Map | null>,
  isMapReady: boolean,
  onBackgroundClick?: () => void
): void {
  const callbackRef = useRef(onBackgroundClick);

  useEffect(() => {
    callbackRef.current = onBackgroundClick;
  }, [onBackgroundClick]);

  useEffect(() => {
    const mapInstance = mapInstanceRef.current;
    if (!mapInstance || !isMapReady) return;

    const handleClick = () => callbackRef.current?.();
    mapInstance.on("click", handleClick);

    return () => {
      mapInstance.off("click", handleClick);
    };
  }, [mapInstanceRef, isMapReady]);
}
