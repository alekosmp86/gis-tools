"use client";

import React from "react";
import type { EjesGeometryMapBase } from "./clientTypes";
import type { EjesMapSubject } from "./ejesMapSubject";
import { OutlineMapView } from "./map/OutlineMapView";
import { useEjesMapFeatures } from "./useEjesMapFeatures";

const MAP_TITLE = "MAPA DE TRAMOS";
const EMPTY_MESSAGE = "No hay geometría que mostrar para este caso.";

export interface EjesMapViewProps {
  subject: EjesMapSubject;
  base: EjesGeometryMapBase;
  selectedOutlineIndex: number | null;
  onSelectOutline: (outlineIndex: number | null) => void;
}

/** The outlines of one split or merge on the shared map view. */
export function EjesMapView({ subject, base, selectedOutlineIndex, onSelectOutline }: EjesMapViewProps) {
  const map = useEjesMapFeatures(subject, base);
  return (
    <OutlineMapView
      map={map}
      outlines={subject.outlines}
      title={MAP_TITLE}
      emptyMessage={EMPTY_MESSAGE}
      selectedOutlineIndex={selectedOutlineIndex}
      onSelectOutline={onSelectOutline}
      showLabels={subject.twin === undefined}
    />
  );
}
