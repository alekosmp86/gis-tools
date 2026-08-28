import React from "react";
import { getDiscrepancyLabel } from "@/constants/mapConstants";
import styles from "../SpatialMapPreview.module.css";

export interface MapLegendProps {
  presentTypes: string[];
}

export const MapLegend: React.FC<MapLegendProps> = ({ presentTypes }) => {
  return (
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
  );
};
