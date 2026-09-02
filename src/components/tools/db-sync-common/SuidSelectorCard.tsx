import React from "react";
import { CheckCircle2, AlertTriangle, Layers, Layers3, Check } from "lucide-react";
import styles from "./SuidSelectorCard.module.css";

export interface SuidSelectorCardProps {
  selectableColumns: string[];
  selectedSuids: string[];
  matchedFileSuids: string[];
  onToggleSuid: (suid: string) => void;
}

export const SuidSelectorCard: React.FC<SuidSelectorCardProps> = ({
  selectableColumns,
  selectedSuids,
  matchedFileSuids,
  onToggleSuid,
}) => {
  const isComposite = selectedSuids.length > 1;
  const allMatched = matchedFileSuids.length > 0 && matchedFileSuids.every((match) => match !== "");
  const selectedSuidSet = new Set(selectedSuids);

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionTitleRow}>
        <span className={styles.sectionBadge}>1</span>
        <div className={styles.titleWithIcon}>
          <h3 className={styles.sectionTitle}>
            Identificador Único Compartido (SUID)
          </h3>
          {isComposite ? (
            <span className={styles.compositeBadge}>
              <Layers3 size={13} />
              Clave Compuesta ({selectedSuids.length} columnas)
            </span>
          ) : (
            <span className={styles.singleBadge}>
              <Layers size={13} />
              Columna Única
            </span>
          )}
        </div>
      </div>

      <p className={styles.sectionDesc}>
        Seleccione <strong>una o más columnas</strong> de la base de datos para formar la clave identificadora única (SUID).
        Si la tabla requiere combinación de columnas (ej. <code>departamento</code> + <code>padron</code>), seleccione múltiples columnas.
      </p>

      {/* Multi-select Pills */}
      <div className={styles.pillsGrid}>
        {selectableColumns.map((column) => {
          const isSelected = selectedSuidSet.has(column);
          return (
            <button
              key={column}
              type="button"
              className={`${styles.pill} ${isSelected ? styles.pillSelected : ""}`}
              onClick={() => onToggleSuid(column)}
              aria-pressed={isSelected}
            >
              <span className={`${styles.customCheck} ${isSelected ? styles.customCheckActive : ""}`}>
                {isSelected && <Check size={12} />}
              </span>
              <span className={styles.pillText}>{column}</span>
            </button>
          );
        })}
      </div>

      {/* Matched SUID Status Display */}
      <div className={styles.matchStatusBox}>
        {allMatched ? (
          <div className={styles.matchSuccess}>
            <CheckCircle2 size={16} />
            <span>
              Coincidencia en archivo fuente:{" "}
              <strong>{matchedFileSuids.join(" + ")}</strong>
            </span>
          </div>
        ) : (
          <div className={styles.matchWarning}>
            <AlertTriangle size={16} />
            <span>
              Advertencia: Algunas columnas SUID compuestas no tienen coincidencia exacta o truncada a 10 caracteres en el archivo fuente.
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
