import React from "react";
import { GitCompare, Eraser } from "lucide-react";
import { SyncMode } from "./syncMode";
import styles from "./SyncModeStep.module.css";

interface SyncModeOption {
  mode: SyncMode;
  title: string;
  description: string;
  icon: React.ReactNode;
  toneClass: string;
}

const OPTIONS: SyncModeOption[] = [
  {
    mode: SyncMode.COMPARE,
    title: "Comparar",
    description:
      "Correlaciona ambas tablas por SUID, detecta discrepancias y genera parches SQL de actualización e inserción. No elimina datos.",
    icon: <GitCompare size={20} />,
    toneClass: styles.optionCompare,
  },
  {
    mode: SyncMode.REPLACE,
    title: "Reemplazo completo",
    description:
      "Vacía la tabla destino y la recarga con todos los registros de la tabla origen. Sin comparación. Acción destructiva.",
    icon: <Eraser size={20} />,
    toneClass: styles.optionReplace,
  },
];

export interface SyncModeStepProps {
  mode: SyncMode;
  onModeChange: (mode: SyncMode) => void;
}

export const SyncModeStep: React.FC<SyncModeStepProps> = ({ mode, onModeChange }) => {
  return (
    <div className={styles.options} role="radiogroup" aria-label="Modo de sincronización">
      {OPTIONS.map((option) => (
        <label
          key={option.mode}
          className={`${styles.option} ${option.toneClass} ${mode === option.mode ? styles.optionSelected : ""}`}
        >
          <input
            type="radio"
            name="syncMode"
            className={styles.radio}
            checked={mode === option.mode}
            onChange={() => onModeChange(option.mode)}
          />
          <div className={styles.iconWrapper}>{option.icon}</div>
          <div className={styles.text}>
            <span className={styles.optionTitle}>{option.title}</span>
            <span className={styles.optionDescription}>{option.description}</span>
          </div>
        </label>
      ))}
    </div>
  );
};
