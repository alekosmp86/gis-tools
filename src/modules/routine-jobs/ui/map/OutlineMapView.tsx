"use client";

import React, { useMemo } from "react";
import dynamic from "next/dynamic";
import { RotateCcw } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { RenderErrorBoundary } from "@/ui-kit/components/RenderErrorBoundary";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import type { GeometryMapFeature } from "../jobs/actualizar-padron/types";
import type { GeometryMapBase } from "./clientTypes";
import { OUTLINE_LABEL_PROPERTY, toMapCollection } from "./padronMapCollection";
import type { PadronMapSubject } from "./padronMapSubject";
import { MapLoadStatus, usePadronMapFeatures } from "./usePadronMapFeatures";
import styles from "./PadronMapView.module.css";

const SpatialMapPreview = dynamic(
  () => import("@/ui-kit/components/SpatialMapPreview").then((module) => module.SpatialMapPreview),
  { ssr: false }
);

const ICON_SIZE = 15;
const MAP_TITLE = "MAPA DEL PADRÓN";
const LOADING_MESSAGE = "Cargando geometrías…";
const EMPTY_MESSAGE = "No hay geometría que mostrar para este padrón.";
const FALLBACK_ERROR = "No se pudieron cargar las geometrías del mapa.";
const RETRY_LABEL = "Reintentar";
const MAP_RENDER_ERROR = "No se pudo mostrar el mapa";
const BOUNDARY_LABEL = "routine-jobs padron map";

const mapRenderFailure = (error: Error) => (
  <div className={styles.error}>
    <AlertMessage type={AlertType.ERROR} text={`${MAP_RENDER_ERROR}: ${error.message}`} />
  </div>
);

/** The map feature of a clicked outline. Features and outlines are both numbered by the request item, so the outline is the feature's `itemIndex`. */
const featureIndexOf = (features: readonly GeometryMapFeature[], outlineIndex: number | null): number | null => {
  if (outlineIndex === null) return null;
  const featureIndex = features.findIndex((feature) => feature.itemIndex === outlineIndex);
  return featureIndex < 0 ? null : featureIndex;
};

export interface PadronMapViewProps {
  subject: PadronMapSubject;
  base: GeometryMapBase;
  selectedOutlineIndex: number | null;
  onSelectOutline: (outlineIndex: number | null) => void;
}

/** The outlines of the subject on the map: the loading, failure and empty states, then the map with its labels and clicks. */
export function PadronMapView({ subject, base, selectedOutlineIndex, onSelectOutline }: PadronMapViewProps) {
  const map = usePadronMapFeatures(subject, base);
  const collection = useMemo(() => toMapCollection(map.features, subject.outlines), [map.features, subject.outlines]);

  if (map.status === MapLoadStatus.LOADING) {
    return <p className={styles.status} role="status">{LOADING_MESSAGE}</p>;
  }
  if (map.status === MapLoadStatus.ERROR) {
    return (
      <div className={styles.error}>
        <AlertMessage type={AlertType.ERROR} text={map.message ?? FALLBACK_ERROR} />
        <Button variant={ButtonVariant.SECONDARY} onClick={map.retry}>
          <RotateCcw size={ICON_SIZE} />
          <span>{RETRY_LABEL}</span>
        </Button>
      </div>
    );
  }
  if (map.features.length === 0) return <p className={styles.status}>{EMPTY_MESSAGE}</p>;

  const handleSelectFeature = (featureIndex: number | null) => {
    const feature = featureIndex === null ? undefined : map.features[featureIndex];
    onSelectOutline(feature === undefined ? null : feature.itemIndex);
  };

  return (
    <RenderErrorBoundary label={BOUNDARY_LABEL} fallback={mapRenderFailure}>
      <SpatialMapPreview
        geojson={collection}
        title={MAP_TITLE}
        selectedFeatureIndex={featureIndexOf(map.features, selectedOutlineIndex)}
        onSelectFeature={handleSelectFeature}
        showPopups={false}
        labelProperty={OUTLINE_LABEL_PROPERTY}
        codedLabels
        clearOnBackgroundClick
        fillParent
      />
    </RenderErrorBoundary>
  );
}
