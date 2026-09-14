"use client";

import React, { useState } from "react";
import type { FeatureCollection } from "geojson";
import type { MapFeatureStyle } from "@/core/types/map";
import { DEFAULT_MAP_FEATURE_STYLE } from "@/core/constants/mapConstants";
import { useDeckMap } from "@/ui-kit/hooks/map-gl/useDeckMap";
import { MapHeaderBar } from "./map/MapHeaderBar";
import { MapLegend } from "./map/MapLegend";
import styles from "./DeckMapPreview.module.css";

export interface DeckMapPreviewProps {
  geojson: FeatureCollection;
  title?: string;
  selectedFeatureIndex?: number | null;
  onSelectFeature?: (index: number | null) => void;
  initialStyle?: Partial<MapFeatureStyle>;
  isVisible?: boolean;
}

export const DeckMapPreview: React.FC<DeckMapPreviewProps> = ({
  geojson,
  title = "EXPLORADOR ESPACIAL WEBGL (DECK.GL)",
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

  const { renderedCount, handleFitBounds } = useDeckMap(
    mapContainerNode,
    geojson,
    basemapKey,
    featureStyle,
    selectedFeatureIndex,
    onSelectFeature,
    isVisible
  );

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
      <MapHeaderBar
        title={title}
        totalFeatures={totalFeatures}
        renderedCount={renderedCount}
        isChunking={false}
        basemapKey={basemapKey}
        onSelectBasemap={setBasemapKey}
        onFitBounds={handleFitBounds}
        featureStyle={featureStyle}
        onUpdateFeatureStyle={setFeatureStyle}
        onResetFeatureStyle={handleResetFeatureStyle}
        hasDiscrepancies={presentTypes.length > 0}
      />

      <MapLegend presentTypes={presentTypes} />

      <div
        ref={setMapContainerNode}
        className={styles.mapElement}
        data-rendered-count={renderedCount}
      />
    </div>
  );
};
