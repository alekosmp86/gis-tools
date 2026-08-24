import React from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import type { SuidSelectorCardProps } from "@/types/gis";
import styles from "./SuidSelectorCard.module.css";

export const SuidSelectorCard: React.FC<SuidSelectorCardProps> = ({
  selectableColumns,
  selectedSuid,
  matchedShpSuid,
  onSelectSuid,
}) => {
  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionTitleRow}>
        <span className={styles.sectionBadge}>1</span>
        <h3 className={styles.sectionTitle}>
          Identificador Único Compartido (SUID)
        </h3>
      </div>

      <p className={styles.sectionDesc}>
        Seleccione la columna de la base de datos que se correlacionará contra el atributo correspondiente del Shapefile (ej. <code>padron_id</code>, <code>gid</code>, <code>codigo</code>).
      </p>

      <div className={styles.selectRow}>
        <div className={styles.selectGroup}>
          <label htmlFor="suid-select">Columna SUID (Base de Datos):</label>
          <select
            id="suid-select"
            aria-label="Columna SUID de la base de datos"
            value={selectedSuid}
            onChange={(e) => onSelectSuid(e.target.value)}
            className={styles.dropdown}
          >
            {selectableColumns.map((col) => (
              <option key={col} value={col}>
                {col}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.matchStatusBox}>
          {matchedShpSuid ? (
            <div className={styles.matchSuccess}>
              <CheckCircle2 size={16} />
              <span>
                Coincidencia en Shapefile DBF: <strong>{matchedShpSuid}</strong>
              </span>
            </div>
          ) : (
            <div className={styles.matchWarning}>
              <AlertTriangle size={16} />
              <span>
                Advertencia: No se encontró coincidencia exacta o truncada a 10 caracteres en el DBF.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
