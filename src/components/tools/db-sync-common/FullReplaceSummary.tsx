import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import { formatNumber } from "@/core/common/ValueFormatter";
import type { FullReplaceResult } from "@/core/services/fullReplaceService";
import styles from "./FullReplaceStep.module.css";

export interface FullReplaceSummaryProps {
  result: FullReplaceResult;
}

export const FullReplaceSummary: React.FC<FullReplaceSummaryProps> = ({ result }) => {
  const isMismatch = result.insertedRows !== result.sourceRows;
  const hasErrors = result.errorCount > 0;

  return (
    <div className={styles.summary}>
      {!result.targetModified && (
        <AlertMessage
          type={AlertType.ERROR}
          text="El primer lote falló y fue revertido: la tabla destino NO fue modificada y no se ejecutaron los lotes restantes."
        />
      )}
      {result.targetModified && !isMismatch && !hasErrors && (
        <AlertMessage
          type={AlertType.SUCCESS}
          text="Reemplazo completado: la tabla destino contiene todos los registros del origen."
        />
      )}
      {result.targetModified && (isMismatch || hasErrors) && (
        <AlertMessage
          type={AlertType.WARNING}
          text="Reemplazo incompleto: la tabla destino quedó parcialmente cargada. Puede volver a ejecutar el reemplazo completo de forma segura."
        />
      )}

      <div className={styles.kpiGrid}>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Registros en origen</span>
          <span className={styles.kpiValue}>{formatNumber(result.sourceRows)}</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Registros insertados</span>
          <span className={styles.kpiValue}>{formatNumber(result.insertedRows)}</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Errores</span>
          <span className={styles.kpiValue}>{formatNumber(result.errorCount)}</span>
        </div>
      </div>

      {result.ignoredSourceColumns.length > 0 && (
        <AlertMessage
          type={AlertType.INFO}
          text={`Columnas del origen sin mapear (ignoradas): ${result.ignoredSourceColumns.join(", ")}.`}
        />
      )}

      {result.errors.length > 0 && (
        <ul className={styles.errorList}>
          {result.errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  );
};
