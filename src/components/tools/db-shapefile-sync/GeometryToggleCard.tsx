import React from "react";
import type { GeometryToggleCardProps } from "@/types/comparison";
import styles from "./GeometryToggleCard.module.css";

export const GeometryToggleCard: React.FC<GeometryToggleCardProps> = ({
  compareGeometry,
  onToggleGeometry,
}) => {
  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionTitleRow}>
        <span className={styles.sectionBadge}>3</span>
        <h3 className={styles.sectionTitle}>Comparación de Geometrías Espaciales</h3>
      </div>

      <label className={styles.toggleRow}>
        <input
          type="checkbox"
          checked={compareGeometry}
          onChange={(e) => onToggleGeometry(e.target.checked)}
        />
        <div className={styles.toggleText}>
          <span className={styles.toggleTitle}>
            Comparar forma y coordenadas geométricas (topología espacial)
          </span>
          <span className={styles.toggleSub}>
            Compara topológicamente la geometría PostGIS contra el polígono/línea/punto del Shapefile.
          </span>
        </div>
      </label>
    </div>
  );
};
