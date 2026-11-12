import { useEffect, useRef } from "react";
import L from "leaflet";
import type { FeatureCollection } from "geojson";
import { getDiscrepancyColor } from "@/core/constants/mapConstants";
import { buildPopupHtml } from "@/ui-kit/map/MapPopupPresenter";

const HALO_COLOR = "#ffffff";
const HALO_WEIGHT = 13;

export function useFeatureHighlight(
  mapInstanceRef: React.RefObject<L.Map | null>,
  geojson: FeatureCollection,
  selectedFeatureIndex?: number | null,
  isMapReady: boolean = false,
  showPopups: boolean = true,
  keepTypeColor: boolean = false
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

    if (keepTypeColor && targetFeature.geometry && targetFeature.geometry.type !== "Point") {
      highlightGroup.addLayer(
        L.geoJSON(targetFeature as import("geojson").GeoJsonObject, {
          style: () => ({ color: HALO_COLOR, weight: HALO_WEIGHT, opacity: 0.95, fill: false }),
          interactive: false,
        })
      );
    }

    const highlightSubLayer = L.geoJSON(targetFeature as import("geojson").GeoJsonObject, {
      style: () => {
        if (!keepTypeColor) {
          return { color: "#38bdf8", weight: 7, opacity: 1, fillColor: "#0284c7", fillOpacity: 0.5 };
        }
        const typeColor = getDiscrepancyColor(targetFeature.properties?._discrepancyType);
        return { color: typeColor, weight: 6, opacity: 1, fillColor: typeColor, fillOpacity: 0.5 };
      },
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
        const popupHtml = showPopups ? buildPopupHtml(feature) : "";
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
  }, [mapInstanceRef, selectedFeatureIndex, geojson, isMapReady, showPopups, keepTypeColor]);
}
