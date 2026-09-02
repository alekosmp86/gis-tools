import { useEffect, useRef } from "react";
import L from "leaflet";
import type { FeatureCollection } from "geojson";
import { buildPopupHtml } from "@/utils/map/MapPopupPresenter";

export function useFeatureHighlight(
  mapInstanceRef: React.RefObject<L.Map | null>,
  geojson: FeatureCollection,
  selectedFeatureIndex?: number | null,
  isMapReady: boolean = false
): void {
  const highlightLayerRef = useRef<L.FeatureGroup | null>(null);

  useEffect(() => {
    const mapInstance = mapInstanceRef.current;
    if (!mapInstance || !isMapReady) return;

    if (highlightLayerRef.current) {
      mapInstance.removeLayer(highlightLayerRef.current);
      highlightLayerRef.current = null;
    }

    if (selectedFeatureIndex === null || selectedFeatureIndex === undefined) {
      return;
    }

    if (!geojson || !geojson.features || !geojson.features[selectedFeatureIndex]) {
      return;
    }

    const targetFeature = geojson.features[selectedFeatureIndex];

    const highlightGroup = L.featureGroup().addTo(mapInstance);
    highlightLayerRef.current = highlightGroup;

    const highlightSubLayer = L.geoJSON(targetFeature as import("geojson").GeoJsonObject, {
      style: () => ({
        color: "#38bdf8",
        weight: 7,
        opacity: 1,
        fillColor: "#0284c7",
        fillOpacity: 0.5,
      }),
      pointToLayer: (_feature, latlng) => {
        return L.circleMarker(latlng, {
          radius: 12,
          fillColor: "#38bdf8",
          color: "#ffffff",
          weight: 3,
          opacity: 1,
          fillOpacity: 0.95,
        });
      },
      onEachFeature: (feature, layer) => {
        const popupHtml = buildPopupHtml(feature);
        if (popupHtml) {
          layer.bindPopup(popupHtml, {
            closeButton: true,
            autoPan: true,
            maxWidth: 310,
          }).openPopup();
        }
      },
    });

    highlightGroup.addLayer(highlightSubLayer);

    mapInstance.invalidateSize();
    const bounds = highlightGroup.getBounds();
    if (bounds.isValid()) {
      if (targetFeature.geometry && targetFeature.geometry.type === "Point") {
        mapInstance.setView(bounds.getCenter(), Math.max(mapInstance.getZoom(), 16), { animate: true });
      } else {
        mapInstance.fitBounds(bounds, { padding: [60, 60], maxZoom: 17, animate: true });
      }
    }

    return () => {
      if (highlightLayerRef.current && mapInstance) {
        try {
          highlightLayerRef.current.clearLayers();
          mapInstance.removeLayer(highlightLayerRef.current);
          highlightLayerRef.current = null;
        } catch {
          // Safe disposal
        }
      }
    };
  }, [mapInstanceRef, selectedFeatureIndex, geojson, isMapReady]);
}
