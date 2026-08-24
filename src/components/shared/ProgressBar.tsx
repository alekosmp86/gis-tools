import React from "react";
import styles from "./ProgressBar.module.css";

interface ProgressBarProps {
  phase: string;
  current: number;
  total: number;
  pct: number;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ phase, current, total, pct }) => {
  return (
    <div className={styles.container}>
      <div className={styles.phaseRow}>
        <span className={styles.phaseLabel}>{phase}</span>
        <span className={styles.pctLabel}>{pct}%</span>
      </div>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${pct}%` }} />
      </div>
      {total > 0 && (
        <div className={styles.countRow}>
          <span className={styles.countLabel}>
            {current.toLocaleString("es-UY")} / {total.toLocaleString("es-UY")} registros
          </span>
        </div>
      )}
    </div>
  );
};
