"use client";

import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Layers, Maximize2 } from "lucide-react";
import type { FeatureCollection } from "geojson";
import {
  BASEMAP_TILES,
  getDiscrepancyColor,
  getDiscrepancyLabel,
} from "@/constants/mapConstants";
import "leaflet/dist/leaflet.css";
import styles from "./SpatialMapPreview.module.css";

interface SpatialMapPreviewProps {
  geojson: FeatureCollection;
  title?: string;
}

export const SpatialMapPreview: React.FC<SpatialMapPreviewProps> = ({
  geojson,
  title = "VISTA PREVIA ESPACIAL EN MAPA",
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const geojsonLayerRef = useRef<L.GeoJSON | null>(null);
  const [basemapKey, setBasemapKey] = useState<string>("voyager");

  // Extract unique discrepancy types present in geojson for legend rendering
  const presentTypes = Array.from(
    new Set(
      (geojson?.features || []).flatMap((f) => {
        const type = f.properties?._discrepancyType as string | undefined;
        return type ? [type] : [];
      })
    )
  );

  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: false,
      }).setView([-32.5, -56.0], 7); // Center of Uruguay

      L.control.zoom({ position: "bottomright" }).addTo(map);
      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;

    // Update Basemap tile layer
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const tileConfig = BASEMAP_TILES[basemapKey] || BASEMAP_TILES.voyager;
    const tileLayer = L.tileLayer(tileConfig.url, {
      maxZoom: tileConfig.maxZoom,
      subdomains: tileConfig.subdomains || "abc",
    }).addTo(map);
    tileLayerRef.current = tileLayer;

    // Render Vector GeoJSON Layer
    if (geojsonLayerRef.current) {
      map.removeLayer(geojsonLayerRef.current);
    }

    if (geojson && geojson.features && geojson.features.length > 0) {
      const geojsonLayer = L.geoJSON(geojson as import("geojson").GeoJsonObject, {
        style: (feature) => {
          const type = feature?.properties?._discrepancyType;
          const color = getDiscrepancyColor(type);
          return {
            color,
            weight: 4.5,
            opacity: 0.9,
          };
        },
        pointToLayer: (feature, latlng) => {
          const type = feature?.properties?._discrepancyType;
          const color = getDiscrepancyColor(type);
          return L.circleMarker(latlng, {
            radius: 7,
            fillColor: color,
            color: "#ffffff",
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9,
          });
        },
        onEachFeature: (feature, layer) => {
          if (feature.properties) {
            const props = feature.properties;
            const discType = props._discrepancyType;
            const discColor = getDiscrepancyColor(discType);
            const typeLabel = getDiscrepancyLabel(discType);
            const titleProp = props.nombre || props.name || props.reftramo || props.suid || props.id || "Entidad Espacial";
            const noteText = props._discrepancyNote ? `<div style="color: #64748b; font-size: 11px; margin-top: 4px;">${props._discrepancyNote}</div>` : "";

            const subProps = Object.entries(props)
              .filter(
                ([k]) =>
                  !k.startsWith("_") &&
                  !/^(geom|geometry|wkt|wkb|wkb_geometry)$/i.test(k.trim())
              )
              .slice(0, 6)
              .map(([k, v]) => {
                const rawValStr = String(v);
                const displayVal =
                  rawValStr.length > 45 ? `${rawValStr.substring(0, 42)}...` : rawValStr;
                return `<strong>${k}:</strong> <span style="word-break: break-all;">${displayVal}</span>`;
              })
              .join("<br/>");

            layer.bindPopup(
              `<div style="font-family: sans-serif; font-size: 12px; color: #0f172a; max-width: 280px; overflow-wrap: break-word;">` +
                `<div style="display: inline-block; padding: 2px 8px; border-radius: 4px; background: ${discColor}; color: #fff; font-weight: bold; font-size: 10px; margin-bottom: 6px;">${typeLabel}</div><br/>` +
                `<strong style="color: #0284c7; font-size: 13px;">${titleProp}</strong>` +
                `${noteText}` +
                `<hr style="margin: 6px 0; border: none; border-top: 1px solid #cbd5e1;"/>` +
                `${subProps}</div>`,
              {
                closeButton: true,
                autoPan: true,
                maxWidth: 310,
              }
            );
          }
        },
      }).addTo(map);

      geojsonLayerRef.current = geojsonLayer;

      const bounds = geojsonLayer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [30, 30] });
      }
    }
  }, [geojson, basemapKey]);

  const handleFitBounds = () => {
    if (mapInstanceRef.current && geojsonLayerRef.current) {
      const bounds = geojsonLayerRef.current.getBounds();
      if (bounds.isValid()) {
        mapInstanceRef.current.fitBounds(bounds, { padding: [30, 30] });
      }
    }
  };

  const featureCount = geojson?.features?.length || 0;

  return (
    <div className={styles.mapContainer}>
      <div className={styles.mapHeaderBar}>
        <div className={styles.mapBadge}>
          <Layers size={14} className={styles.badgeIcon} />
          <span>
            {title} &bull; {featureCount.toLocaleString("es-UY")} entidades
          </span>
        </div>

        <div className={styles.mapControls}>
          <select
            value={basemapKey}
            onChange={(e) => setBasemapKey(e.target.value)}
            className={styles.selectBasemap}
            aria-label="Seleccionar mapa base"
          >
            <option value="voyager">🗺️ Mapa de Calles (Voyager)</option>
            <option value="osm">🛣️ OpenStreetMap (Estándar)</option>
            <option value="satellite">🛰️ Satélite (Esri World)</option>
            <option value="dark">🌙 Modo Oscuro (CartoDB)</option>
          </select>

          <button
            type="button"
            onClick={handleFitBounds}
            title="Ajustar vista a los límites de la capa"
            className={styles.controlBtn}
          >
            <Maximize2 size={15} />
          </button>
        </div>
      </div>

      {/* Map Legend Overlay */}
      <div className={styles.legendPanel}>
        <div className={styles.legendTitle}>Leyenda del Mapa</div>
        {presentTypes.length > 0 ? (
          presentTypes.map((type) => (
            <div key={type} className={styles.legendItem}>
              <div className={styles.legendDot} data-color-type={type} />
              <span>{getDiscrepancyLabel(type)}</span>
            </div>
          ))
        ) : (
          <div className={styles.legendItem}>
            <div className={styles.legendDot} data-color-type="DEFAULT" />
            <span>Entidades del Archivo</span>
          </div>
        )}
      </div>

      <div ref={mapContainerRef} className={styles.mapElement} />
    </div>
  );
};
