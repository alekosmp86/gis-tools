import React from "react";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { formatNumber } from "@/utils/common/ValueFormatter";
import type { ExecuteChunkProgress } from "@/types/db";
import styles from "../SqlExecutionModal.module.css";

export interface SqlExecutionProgressProps {
  progress: ExecuteChunkProgress | null;
}

export const SqlExecutionProgress: React.FC<SqlExecutionProgressProps> = ({ progress }) => {
  return (
    <div className={styles.modalBody}>
      <div className={styles.progressSection}>
        {progress && (
          <ProgressBar
            phase={
              progress.phase
                ? progress.phase
                : `Lote ${progress.currentBatch} de ${progress.totalBatches}`
            }
            current={progress.processedStatements}
            total={progress.totalStatements}
            pct={progress.pct}
          />
        )}

        <div className={styles.metricGrid}>
          <div className={styles.metricCard}>
            <span className={styles.metricLabel}>Lotes</span>
            <span className={styles.metricValue}>
              {progress ? `${progress.currentBatch}/${progress.totalBatches}` : "-"}
            </span>
          </div>

          <div className={styles.metricCard}>
            <span className={styles.metricLabel}>Exitosos</span>
            <span className={`${styles.metricValue} ${styles.metricSuccess}`}>
              {formatNumber(progress?.successCount ?? 0)}
            </span>
          </div>

          <div className={styles.metricCard}>
            <span className={styles.metricLabel}>Errores</span>
            <span
              className={`${styles.metricValue} ${
                (progress?.errorCount ?? 0) > 0 ? styles.metricError : ""
              }`}
            >
              {formatNumber(progress?.errorCount ?? 0)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
