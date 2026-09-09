"use client";

import React, { useState } from "react";
import { Info } from "lucide-react";
import type { FeatureCollection } from "geojson";
import type { MapFeatureStyle } from "@/core/types/map";
import { DEFAULT_MAP_FEATURE_STYLE, MAX_MAP_PREVIEW_FEATURES } from "@/core/constants/mapConstants";
import { formatNumber } from "@/core/common/ValueFormatter";
import { useLeafletMap } from "@/ui-kit/hooks/useLeafletMap";
import { MapProgressBar } from "./map/MapProgressBar";
import { MapHeaderBar } from "./map/MapHeaderBar";
import { MapLegend } from "./map/MapLegend";
import "leaflet/dist/leaflet.css";
import styles from "./SpatialMapPreview.module.css";

export interface SpatialMapPreviewProps {
  geojson: FeatureCollection;
  title?: string;
  selectedFeatureIndex?: number | null;
  onSelectFeature?: (index: number | null) => void;
  initialStyle?: Partial<MapFeatureStyle>;
  isVisible?: boolean;
  /** Set false when the caller already explains the cap, to avoid two banners saying the same thing. */
  showCapNotice?: boolean;
}

export const SpatialMapPreview: React.FC<SpatialMapPreviewProps> = ({
  geojson,
  title = "VISTA PREVIA ESPACIAL EN MAPA",
  selectedFeatureIndex,
  onSelectFeature,
  initialStyle,
  isVisible = true,
  showCapNotice = true,
}) => {
  const [mapContainerNode, setMapContainerNode] = useState<HTMLDivElement | null>(null);
  const [basemapKey, setBasemapKey] = useState<string>("osm");
  const [featureStyle, setFeatureStyle] = useState<MapFeatureStyle>(() => ({
    ...DEFAULT_MAP_FEATURE_STYLE,
    ...initialStyle,
  }));

  const suppliedFeatures = geojson?.features ?? [];
  const suppliedFeatureCount = suppliedFeatures.length;

  const isCapped = suppliedFeatureCount > MAX_MAP_PREVIEW_FEATURES;
  const previewGeojson: FeatureCollection = isCapped
    ? { type: "FeatureCollection", features: suppliedFeatures.slice(0, MAX_MAP_PREVIEW_FEATURES) }
    : geojson;

  const totalFeatures = previewGeojson?.features?.length || 0;

  const { renderedCount, isChunking, handleFitBounds } = useLeafletMap(
    mapContainerNode,
    previewGeojson,
    basemapKey,
    featureStyle,
    selectedFeatureIndex,
    onSelectFeature,
    isVisible
  );

  const progressPct = totalFeatures > 0 ? Math.min(100, Math.round((renderedCount / totalFeatures) * 100)) : 0;

  const typesSet = new Set<string>();
  if (previewGeojson?.features) {
    for (let featureIndex = 0; featureIndex < previewGeojson.features.length; featureIndex++) {
      const type = previewGeojson.features[featureIndex].properties?._discrepancyType;
      if (typeof type === "string" && type) {
        typesSet.add(type);
      }
    }
  }
  const presentTypes = Array.from(typesSet);

  const handleResetFeatureStyle = () => {
    setFeatureStyle(DEFAULT_MAP_FEATURE_STYLE);
  };

  return (
    <div className={styles.mapContainer}>
      {isChunking && <MapProgressBar progressPct={progressPct} />}

      <MapHeaderBar
        title={title}
        totalFeatures={totalFeatures}
        renderedCount={renderedCount}
        isChunking={isChunking}
        basemapKey={basemapKey}
        onSelectBasemap={setBasemapKey}
        onFitBounds={handleFitBounds}
        featureStyle={featureStyle}
        onUpdateFeatureStyle={setFeatureStyle}
        onResetFeatureStyle={handleResetFeatureStyle}
        hasDiscrepancies={presentTypes.length > 0}
      />

      {isCapped && showCapNotice && (
        <div className={styles.capNotice}>
          <Info size={14} />
          <span>
            {`Vista previa limitada: mostrando ${formatNumber(MAX_MAP_PREVIEW_FEATURES)} de ${formatNumber(
              suppliedFeatureCount
            )} entidades para mantener la fluidez del mapa.`}
          </span>
        </div>
      )}

      <MapLegend presentTypes={presentTypes} />

      <div ref={setMapContainerNode} className={styles.mapElement} />
    </div>
  );
};
