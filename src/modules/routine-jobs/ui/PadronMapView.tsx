"use client";

import React from "react";
import type { GeometryMapBase } from "./clientTypes";
import { OutlineMapView } from "./map/OutlineMapView";
import type { PadronMapSubject } from "./padronMapSubject";
import { usePadronMapFeatures } from "./usePadronMapFeatures";

const MAP_TITLE = "MAPA DEL PADRÓN";
const EMPTY_MESSAGE = "No hay geometría que mostrar para este padrón.";

export interface PadronMapViewProps {
  subject: PadronMapSubject;
  base: GeometryMapBase;
  selectedOutlineIndex: number | null;
  onSelectOutline: (outlineIndex: number | null) => void;
}

/** The outlines of the padrón subject on the shared map view. */
export function PadronMapView({ subject, base, selectedOutlineIndex, onSelectOutline }: PadronMapViewProps) {
  const map = usePadronMapFeatures(subject, base);
  return (
    <OutlineMapView
      map={map}
      outlines={subject.outlines}
      title={MAP_TITLE}
      emptyMessage={EMPTY_MESSAGE}
      selectedOutlineIndex={selectedOutlineIndex}
      onSelectOutline={onSelectOutline}
    />
  );
}
