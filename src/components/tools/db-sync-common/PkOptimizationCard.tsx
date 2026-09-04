import React from "react";
import { Zap, Key, Info } from "lucide-react";
import styles from "./PkOptimizationCard.module.css";

export interface PkOptimizationCardProps {
  availableColumns: string[];
  detectedPrimaryKey: string | null;
  selectedPrimaryKey: string;
  isEnabled: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onSelectPrimaryKey: (column: string) => void;
}

export const PkOptimizationCard: React.FC<PkOptimizationCardProps> = ({
  availableColumns,
  detectedPrimaryKey,
  selectedPrimaryKey,
  isEnabled,
  onToggleEnabled,
  onSelectPrimaryKey,
}) => {
  const effectiveColumn = selectedPrimaryKey || detectedPrimaryKey || "";

  return (
    <div
      className={`${styles.cardContainer} ${
        isEnabled && effectiveColumn ? styles.cardContainerActive : ""
      }`}
    >
      <div className={styles.headerRow}>
        <div className={styles.titleArea}>
          <div className={styles.iconWrapper}>
            <Zap size={18} />
          </div>
          <h4 className={styles.titleText}>
            Optimización de Actualización (WHERE Clave Primaria)
          </h4>
          {isEnabled && effectiveColumn ? (
            <span className={styles.activeBadge}>
              <Key size={13} />
              WHERE &quot;{effectiveColumn}&quot; = ...
            </span>
          ) : (
            <span className={styles.inactiveBadge}>
              WHERE Clave SUID Compuesta
            </span>
          )}
        </div>

        <label className={styles.toggleLabel}>
          <input
            type="checkbox"
            className={styles.toggleInput}
            checked={isEnabled}
            onChange={(event) => onToggleEnabled(event.target.checked)}
          />
          <span
            className={`${styles.toggleTrack} ${
              isEnabled ? styles.toggleTrackActive : ""
            }`}
          >
            <span
              className={`${styles.toggleThumb} ${
                isEnabled ? styles.toggleThumbActive : ""
              }`}
            />
          </span>
          <span>Habilitar búsqueda por PK</span>
        </label>
      </div>

      <p className={styles.descriptionText}>
        {detectedPrimaryKey ? (
          <>
            Se detectó la clave primaria <code>{detectedPrimaryKey}</code> en PostgreSQL.
            Al habilitar esta opción, las sentencias SQL <code>UPDATE</code> utilizarán{" "}
            <code>WHERE &quot;{effectiveColumn}&quot; = ...</code> en lugar de evaluar
            múltiples columnas de la clave compuesta, evitando escaneos secuenciales y acelerando
            drásticamente la sincronización en tablas con más de 1M de filas.
          </>
        ) : (
          <>
            Si la tabla cuenta con una columna identificadora única indexada (ej. <code>id</code>,{" "}
            <code>gid</code>, <code>ogc_fid</code>), selecciónela para que las sentencias{" "}
            <code>UPDATE</code> busquen directamente por esa columna única en lugar de la clave SUID compuesta.
          </>
        )}
      </p>

      {isEnabled && (
        <div className={styles.controlsRow}>
          <div className={styles.selectGroup}>
            <label htmlFor="pk-column-select" className={styles.selectLabel}>
              Columna para condición WHERE:
            </label>
            <select
              id="pk-column-select"
              className={styles.columnSelect}
              value={effectiveColumn}
              onChange={(event) => onSelectPrimaryKey(event.target.value)}
            >
              <option value="">-- Seleccionar columna --</option>
              {availableColumns.map((columnName) => (
                <option key={columnName} value={columnName}>
                  {columnName}
                  {columnName === detectedPrimaryKey ? " (Clave Primaria DB)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.noticeBox}>
            <Info size={14} />
            <span>
              Nota: La clave primaria solo se utiliza en la cláusula WHERE de <code>UPDATE</code>.
              Las sentencias <code>INSERT</code> seguirán utilizando los valores de negocio del SUID.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
