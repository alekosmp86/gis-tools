import React from "react";
import styles from "./GeometryToggleCard.module.css";

export interface GeometryToggleCardProps {
  compareGeometry: boolean;
  onToggleGeometry: (enabled: boolean) => void;
}

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
          onChange={(event) => onToggleGeometry(event.target.checked)}
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
