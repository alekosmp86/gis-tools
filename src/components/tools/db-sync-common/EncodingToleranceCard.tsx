import React from "react";
import { Languages, ShieldCheck, AlertCircle } from "lucide-react";
import styles from "./EncodingToleranceCard.module.css";

export interface EncodingToleranceCardProps {
  isEnabled: boolean;
  onToggleEnabled: (enabled: boolean) => void;
}

export const EncodingToleranceCard: React.FC<EncodingToleranceCardProps> = ({
  isEnabled,
  onToggleEnabled,
}) => {
  return (
    <div
      className={`${styles.cardContainer} ${
        isEnabled ? styles.cardContainerActive : ""
      }`}
    >
      <div className={styles.headerRow}>
        <div className={styles.titleArea}>
          <div className={styles.iconWrapper}>
            <Languages size={18} />
          </div>
          <h4 className={styles.titleText}>
            Tolerancia a Artefactos de Codificación (Glitches de Exportación)
          </h4>
          {isEnabled ? (
            <span className={styles.activeBadge}>
              <ShieldCheck size={13} />
              Tolerancia Activa
            </span>
          ) : (
            <span className={styles.inactiveBadge}>
              <AlertCircle size={13} />
              Comparación Estricta Byte a Byte
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
          <span>Tolerar caracteres corruptos</span>
        </label>
      </div>

      <p className={styles.descriptionText}>
        Resuelve discrepancias falsas generadas por exportadores GIS que corrompen caracteres
        españoles de doble byte (por ejemplo, el carácter Hangul <code>헡</code> en lugar de{" "}
        <code>Ñ</code> o <code>ÑO</code>, o artefactos mojibake como <code>Ã‘</code>).
      </p>

      <div className={styles.noticeBox}>
        <ShieldCheck size={16} />
        <span>
          <strong>Sensibilidad Estricta Garantizada:</strong> La tolerancia solo repara fallas
          conocidas de codificación. Mantiene total sensibilidad a mayúsculas/minúsculas y
          signos de puntuación.
        </span>
      </div>
    </div>
  );
};
