"use client";

import React, { useMemo, useState } from "react";
import { AlertCircle, Info } from "lucide-react";
import type { FeatureCollection } from "geojson";
import type { MapFeatureStyle } from "@/core/types/map";
import type { MapInteractionOptions } from "@/ui-kit/types/map";
import { DEFAULT_MAP_FEATURE_STYLE, MAX_VIEWPORT_RENDER_FEATURES } from "@/core/constants/mapConstants";
import { formatNumber } from "@/core/common/ValueFormatter";
import { useLeafletMap } from "@/ui-kit/hooks/useLeafletMap";
import { MapProgressBar } from "./map/MapProgressBar";
import { MapHeaderBar } from "./map/MapHeaderBar";
import { MapLegend } from "./map/MapLegend";
import { capPreview, containerClassOf, presentTypesOf } from "./spatialPreviewLogic";
import "leaflet/dist/leaflet.css";
import styles from "./SpatialMapPreview.module.css";

const RENDER_ERROR_PREFIX = "No se pudieron dibujar las geometrías en el mapa";

export interface SpatialMapPreviewProps {
  geojson: FeatureCollection;
  title?: string;
  selectedFeatureIndex?: number | null;
  onSelectFeature?: (index: number | null) => void;
  initialStyle?: Partial<MapFeatureStyle>;
  isVisible?: boolean;
  /** Maximum features to draw. Pass null to render everything, as the discrepancy map requires. */
  maxFeatures?: number | null;
  /** Set false when the caller already explains the cap, to avoid two banners saying the same thing. */
  showCapNotice?: boolean;
  /**
   * Controls whether the viewport-windowing layer may ever truncate features for density.
   * Separate from maxFeatures, which only controls the static pre-slice before the map.
   */
  neverCapViewportRender?: boolean;
  /** Set false to open no popup on click or on highlight; the caller shows the feature itself. */
  showPopups?: boolean;
  /** Feature property drawn as a permanent label on each feature. */
  labelProperty?: string;
  /** Offset labels by their `_labelSlot` property and outline each in its feature colour; the selected feature keeps its colour. */
  codedLabels?: boolean;
  /** A click on empty map reports null through onSelectFeature. */
  clearOnBackgroundClick?: boolean;
  /** Fill the height of the parent instead of the default fixed height. The parent must have a definite height. */
  fillParent?: boolean;
}

export const SpatialMapPreview: React.FC<SpatialMapPreviewProps> = ({
  geojson,
  title = "VISTA PREVIA ESPACIAL EN MAPA",
  selectedFeatureIndex,
  onSelectFeature,
  initialStyle,
  isVisible = true,
  maxFeatures = null,
  showCapNotice = true,
  neverCapViewportRender = false,
  showPopups = true,
  labelProperty,
  clearOnBackgroundClick = false,
  codedLabels = false,
  fillParent = false,
}) => {
  const [mapContainerNode, setMapContainerNode] = useState<HTMLDivElement | null>(null);
  const [basemapKey, setBasemapKey] = useState<string>("osm");
  const [featureStyle, setFeatureStyle] = useState<MapFeatureStyle>(() => ({
    ...DEFAULT_MAP_FEATURE_STYLE,
    ...initialStyle,
  }));

  const preview = capPreview(geojson, maxFeatures);
  const previewGeojson = preview.collection;
  const totalFeatures = preview.shownCount;

  const maxRenderFeatures = neverCapViewportRender ? null : MAX_VIEWPORT_RENDER_FEATURES;
  const interaction = useMemo<MapInteractionOptions>(
    () => ({ showPopups, labelProperty, codedLabels, clearOnBackgroundClick }),
    [showPopups, labelProperty, codedLabels, clearOnBackgroundClick]
  );

  const { renderedCount, isChunking, renderError, handleFitBounds } = useLeafletMap(
    mapContainerNode,
    previewGeojson,
    basemapKey,
    featureStyle,
    selectedFeatureIndex,
    onSelectFeature,
    isVisible,
    maxRenderFeatures,
    interaction
  );

  const progressPct = totalFeatures > 0 ? Math.min(100, Math.round((renderedCount / totalFeatures) * 100)) : 0;
  const presentTypes = presentTypesOf(previewGeojson);

  const handleResetFeatureStyle = () => {
    setFeatureStyle(DEFAULT_MAP_FEATURE_STYLE);
  };

  return (
    <div className={containerClassOf(fillParent, styles.mapContainer, styles.fillParent)}>
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

      {preview.isCapped && showCapNotice && (
        <div className={styles.capNotice}>
          <Info size={14} />
          <span>
            {`Vista previa limitada: mostrando ${formatNumber(preview.shownCount)} de ${formatNumber(
              preview.suppliedCount
            )} entidades para mantener la fluidez del mapa.`}
          </span>
        </div>
      )}

      <MapLegend presentTypes={presentTypes} />

      {renderError !== null && (
        <div className={styles.renderError} role="alert">
          <AlertCircle size={16} />
          <span>{`${RENDER_ERROR_PREFIX}: ${renderError.message}`}</span>
        </div>
      )}

      <div
        ref={setMapContainerNode}
        className={styles.mapElement}
        data-rendered-count={renderedCount}
      />
    </div>
  );
};
