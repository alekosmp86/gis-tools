import React from "react";
import { Zap, Key, Info } from "lucide-react";
import { OptionToggleCard, OptionToggleNotice } from "./OptionToggleCard";
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
    <OptionToggleCard
      tone="amber"
      icon={<Zap size={18} />}
      title="Optimización de Actualización (WHERE Clave Primaria)"
      isEnabled={isEnabled}
      isActive={Boolean(isEnabled && effectiveColumn)}
      activeBadge={
        <>
          <Key size={13} />
          WHERE &quot;{effectiveColumn}&quot; = ...
        </>
      }
      inactiveBadge="WHERE Clave SUID Compuesta"
      toggleLabel="Habilitar búsqueda por PK"
      onToggleEnabled={onToggleEnabled}
      description={
        detectedPrimaryKey ? (
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
        )
      }
    >
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

          <OptionToggleNotice>
            <Info size={14} />
            <span>
              Nota: La clave primaria solo se utiliza en la cláusula WHERE de <code>UPDATE</code>.
              Las sentencias <code>INSERT</code> seguirán utilizando los valores de negocio del SUID.
            </span>
          </OptionToggleNotice>
        </div>
      )}
    </OptionToggleCard>
  );
};
