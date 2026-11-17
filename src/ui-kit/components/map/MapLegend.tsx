import React from "react";
import { getDiscrepancyColor, MAP_POINT_TYPES } from "@/core/constants/mapConstants";
import type { MapLegendEntry } from "@/ui-kit/types/map";
import styles from "../SpatialMapPreview.module.css";

const SWATCH_COLOR_VARIABLE = "--map-legend-color";

const swatchColorRef = (color: string) => (node: HTMLDivElement | null) => {
  node?.style.setProperty(SWATCH_COLOR_VARIABLE, color);
};

const LegendSwatch: React.FC<{ type?: string }> = ({ type }) => (
  <div
    className={styles.legendDot}
    ref={swatchColorRef(getDiscrepancyColor(type))}
    data-point={type !== undefined && MAP_POINT_TYPES.includes(type) ? "true" : undefined}
  />
);

export interface MapLegendProps {
  entries: MapLegendEntry[];
}

export const MapLegend: React.FC<MapLegendProps> = ({ entries }) => {
  return (
    <div className={styles.legendPanel}>
      <div className={styles.legendTitle}>Leyenda del Mapa</div>
      {entries.length > 0 ? (
        entries.map((entry) => (
          <div key={entry.type} className={styles.legendItem}>
            <LegendSwatch type={entry.type} />
            <span>{entry.label}</span>
          </div>
        ))
      ) : (
        <div className={styles.legendItem}>
          <LegendSwatch />
          <span>Entidades del Archivo</span>
        </div>
      )}
    </div>
  );
};
