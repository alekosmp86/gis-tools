"use client";

import React, { useState } from "react";
import type { SpatialMapPreviewProps } from "@/types/map";
import { useLeafletMap } from "@/hooks/useLeafletMap";
import { MapProgressBar } from "./map/MapProgressBar";
import { MapHeaderBar } from "./map/MapHeaderBar";
import { MapLegend } from "./map/MapLegend";
import "leaflet/dist/leaflet.css";
import styles from "./SpatialMapPreview.module.css";

export const SpatialMapPreview: React.FC<SpatialMapPreviewProps> = ({
  geojson,
  title = "VISTA PREVIA ESPACIAL EN MAPA",
  selectedFeatureIndex,
  onSelectFeature,
}) => {
  const [mapContainerNode, setMapContainerNode] = useState<HTMLDivElement | null>(null);
  const [basemapKey, setBasemapKey] = useState<string>("osm");

  const totalFeatures = geojson?.features?.length || 0;

  const { renderedCount, isChunking, handleFitBounds } = useLeafletMap(
    mapContainerNode,
    geojson,
    basemapKey,
    selectedFeatureIndex,
    onSelectFeature
  );

  const progressPct = totalFeatures > 0 ? Math.min(100, Math.round((renderedCount / totalFeatures) * 100)) : 0;

  const presentTypes = Array.from(
    new Set(
      (geojson?.features || []).flatMap((f) => {
        const type = f.properties?._discrepancyType as string | undefined;
        return type ? [type] : [];
      })
    )
  );

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
      />

      <MapLegend presentTypes={presentTypes} />

      <div ref={setMapContainerNode} className={styles.mapElement} />
    </div>
  );
};
