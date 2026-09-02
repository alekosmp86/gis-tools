import React from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatNumber } from "@/utils/common/ValueFormatter";
import type { ExecuteBatchResult } from "@/types/db";
import styles from "../SqlExecutionModal.module.css";

export interface SqlExecutionSummaryProps {
  result: ExecuteBatchResult | null;
  onFinish: () => void;
}

export const SqlExecutionSummary: React.FC<SqlExecutionSummaryProps> = ({ result, onFinish }) => {
  return (
    <>
      <div className={styles.modalBody}>
        {/* Status Alert Banner */}
        <div
          className={`${styles.summaryAlert} ${
            result?.success ? "" : styles.summaryAlertWarning
          }`}
        >
          {result?.success ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
          <span>{result?.message}</span>
        </div>

        {/* Metrics Grid */}
        <div className={styles.metricGrid}>
          <div className={styles.metricCard}>
            <span className={styles.metricLabel}>Total Procesados</span>
            <span className={styles.metricValue}>
              {formatNumber(result?.totalProcessed)}
            </span>
          </div>

          <div className={styles.metricCard}>
            <span className={styles.metricLabel}>Registros Afectados</span>
            <span className={`${styles.metricValue} ${styles.metricSuccess}`}>
              {formatNumber(result?.affectedRows)}
            </span>
          </div>

          <div className={styles.metricCard}>
            <span className={styles.metricLabel}>Errores</span>
            <span
              className={`${styles.metricValue} ${
                (result?.errorCount ?? 0) > 0 ? styles.metricError : ""
              }`}
            >
              {formatNumber(result?.errorCount)}
            </span>
          </div>
        </div>

        {/* Error Items List */}
        {result && result.errors.length > 0 && (
          <div className={styles.errorListBox}>
            {result.errors.map((err) => (
              <div key={err} className={styles.errorItem}>
                {err}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.modalFooter}>
        <Button type="button" variant="primary" onClick={onFinish}>
          <CheckCircle2 size={16} />
          <span>Finalizar y Actualizar Resultados</span>
        </Button>
      </div>
    </>
  );
};
