import { useEffect, useRef } from "react";
import { Popup, type Map } from "maplibre-gl";
import { GeoJsonLayer } from "@deck.gl/layers";
import type { FeatureCollection, Feature, Geometry } from "geojson";
import type { BBox } from "@/core/types/map";
import { buildPopupHtml } from "@/ui-kit/map/MapPopupPresenter";

function extractCoordinates(geometry: Geometry): number[][] {
  if (geometry.type === "Point") {
    return [geometry.coordinates];
  }
  if (geometry.type === "MultiPoint" || geometry.type === "LineString") {
    return geometry.coordinates;
  }
  if (geometry.type === "MultiLineString" || geometry.type === "Polygon") {
    return geometry.coordinates.flat(1);
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flat(2);
  }
  if (geometry.type === "GeometryCollection") {
    return geometry.geometries.flatMap(extractCoordinates);
  }
  return [];
}

function computeFeatureSpatialBounds(feature: Feature): { bbox: BBox; center: [number, number] } | null {
  if (!feature.geometry) return null;
  const coordinates = extractCoordinates(feature.geometry);
  if (coordinates.length === 0) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (let index = 0; index < coordinates.length; index++) {
    const [lng, lat] = coordinates[index];
    if (typeof lng === "number" && typeof lat === "number") {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
  }

  if (minLng === Infinity || minLat === Infinity) {
    return null;
  }

  return {
    bbox: [minLng, minLat, maxLng, maxLat],
    center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
  };
}

export function useDeckFeatureHighlight(
  mapInstanceRef: React.RefObject<Map | null>,
  geojson: FeatureCollection,
  selectedFeatureIndex?: number | null,
  isMapReady: boolean = false
): GeoJsonLayer | null {
  const popupRef = useRef<Popup | null>(null);

  const targetFeature: Feature | null =
    selectedFeatureIndex === null ||
    selectedFeatureIndex === undefined ||
    !geojson?.features ||
    !geojson.features[selectedFeatureIndex]
      ? null
      : geojson.features[selectedFeatureIndex];

  useEffect(() => {
    const mapInstance = mapInstanceRef.current;
    if (!mapInstance || !isMapReady) return;

    if (popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }

    if (!targetFeature) return;

    const spatialBounds = computeFeatureSpatialBounds(targetFeature);
    if (!spatialBounds) return;

    const { bbox, center } = spatialBounds;

    if (targetFeature.geometry && targetFeature.geometry.type === "Point") {
      mapInstance.flyTo({
        center,
        zoom: Math.max(mapInstance.getZoom(), 16),
        essential: true,
        animate: false,
      });
    } else {
      mapInstance.fitBounds(
        [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[3]],
        ],
        { padding: 60, maxZoom: 17, animate: false }
      );
    }

    const popupHtml = buildPopupHtml(targetFeature);
    if (popupHtml) {
      const popup = new Popup({
        closeButton: true,
        maxWidth: "310px",
        closeOnClick: false,
        closeOnMove: false,
      })
        .setLngLat(center)
        .setHTML(popupHtml)
        .addTo(mapInstance);

      popupRef.current = popup;
    }

    return () => {
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    };
  }, [mapInstanceRef, targetFeature, isMapReady]);

  if (!targetFeature) return null;

  return new GeoJsonLayer({
    id: "deck-geojson-highlight-layer",
    data: [targetFeature],
    pickable: false,
    filled: true,
    getFillColor: [2, 132, 199, 128],
    stroked: true,
    getLineColor: [56, 189, 248, 255],
    getLineWidth: 6,
    lineWidthUnits: "pixels",
    pointType: "circle",
    getPointRadius: 11,
    pointRadiusUnits: "pixels",
  });
}
