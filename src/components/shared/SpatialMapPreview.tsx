"use client";

import React, { useState } from "react";
import type { FeatureCollection } from "geojson";
import type { MapFeatureStyle } from "@/types/map";
import { DEFAULT_MAP_FEATURE_STYLE } from "@/constants/mapConstants";
import { useLeafletMap } from "@/hooks/useLeafletMap";
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
}

export const SpatialMapPreview: React.FC<SpatialMapPreviewProps> = ({
  geojson,
  title = "VISTA PREVIA ESPACIAL EN MAPA",
  selectedFeatureIndex,
  onSelectFeature,
  initialStyle,
  isVisible = true,
}) => {
  const [mapContainerNode, setMapContainerNode] = useState<HTMLDivElement | null>(null);
  const [basemapKey, setBasemapKey] = useState<string>("osm");
  const [featureStyle, setFeatureStyle] = useState<MapFeatureStyle>(() => ({
    ...DEFAULT_MAP_FEATURE_STYLE,
    ...initialStyle,
  }));

  const totalFeatures = geojson?.features?.length || 0;

  const { renderedCount, isChunking, handleFitBounds } = useLeafletMap(
    mapContainerNode,
    geojson,
    basemapKey,
    featureStyle,
    selectedFeatureIndex,
    onSelectFeature,
    isVisible
  );

  const progressPct = totalFeatures > 0 ? Math.min(100, Math.round((renderedCount / totalFeatures) * 100)) : 0;

  const typesSet = new Set<string>();
  if (geojson?.features) {
    for (let featureIndex = 0; featureIndex < geojson.features.length; featureIndex++) {
      const type = geojson.features[featureIndex].properties?._discrepancyType;
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

      <MapLegend presentTypes={presentTypes} />

      <div ref={setMapContainerNode} className={styles.mapElement} />
    </div>
  );
};
