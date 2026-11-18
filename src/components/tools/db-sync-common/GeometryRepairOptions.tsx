import React from "react";
import { GEOMETRY_REPAIR_MAX_DECIMALS, GEOMETRY_REPAIR_MIN_DECIMALS } from "@/core/services/geometryRepairSql";
import styles from "./FullReplaceStep.module.css";

export interface GeometryRepairOptionsProps {
  enabled: boolean;
  decimalsInput: string;
  decimalsValid: boolean;
  disabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onDecimalsInputChange: (value: string) => void;
}

export const GeometryRepairOptions: React.FC<GeometryRepairOptionsProps> = ({
  enabled,
  decimalsInput,
  decimalsValid,
  disabled,
  onEnabledChange,
  onDecimalsInputChange,
}) => (
  <div className={styles.formGroup}>
    <label className={styles.checkboxRow}>
      <input
        type="checkbox"
        checked={enabled}
        onChange={(event) => onEnabledChange(event.target.checked)}
        disabled={disabled}
      />
      <span>Reparar geometrías</span>
    </label>
    {enabled ? (
      <>
        <div className={styles.decimalsRow}>
          <label htmlFor="fullReplaceDecimalsInput">Decimales de control en EPSG:4326</label>
          <input
            id="fullReplaceDecimalsInput"
            type="number"
            min={GEOMETRY_REPAIR_MIN_DECIMALS}
            max={GEOMETRY_REPAIR_MAX_DECIMALS}
            step={1}
            value={decimalsInput}
            onChange={(event) => onDecimalsInputChange(event.target.value)}
            className={decimalsValid ? styles.numberInput : `${styles.numberInput} ${styles.numberInputInvalid}`}
            aria-invalid={!decimalsValid}
            disabled={disabled}
          />
        </div>
        {!decimalsValid && (
          <span className={styles.fieldError}>Ingrese un número entero entre 0 y 8.</span>
        )}
        <span className={styles.helpText}>
          Corrige polígonos inválidos y quita las partes que quedarían con menos de 4 vértices al redondearlas a esta
          cantidad de decimales de grado en EPSG:4326. Las coordenadas guardadas no se redondean. Si todas las partes de
          una fila desaparecen, la fila conserva su geometría.
        </span>
      </>
    ) : (
      <span className={styles.helpText}>Las geometrías se cargan tal como vienen del origen.</span>
    )}
  </div>
);
