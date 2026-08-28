import { Database, X, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import type { ExecuteBatchResult, ExecuteChunkProgress } from "@/types/db";
import styles from "../SqlExecutionModal.module.css";

export interface SqlExecutionHeaderProps {
  isExecuting: boolean;
  isCompleted: boolean;
  result: ExecuteBatchResult | null;
  progress: ExecuteChunkProgress | null;
  statementCount: number;
  onClose: () => void;
}

export const SqlExecutionHeader: React.FC<SqlExecutionHeaderProps> = ({
  isExecuting,
  isCompleted,
  result,
  progress,
  statementCount,
  onClose,
}) => {
  const getHeaderIconClass = () => {
    if (!isCompleted) return "";
    return result?.success ? styles.headerIconSuccess : styles.headerIconWarning;
  };

  const getTitle = () => {
    if (isExecuting) return "Ejecutando en Base de Datos (Lotes de 500)";
    if (isCompleted) {
      return result?.success
        ? "Ejecución Completada con Éxito"
        : "Ejecución Finalizada con Observaciones";
    }
    return "Confirmación de Ejecución en Base de Datos";
  };

  const getSubtitle = () => {
    if (isExecuting) {
      const currentBatch = progress?.currentBatch || 1;
      const totalBatches = progress?.totalBatches || Math.ceil(statementCount / 500) || 1;
      return `Procesando lote ${currentBatch} de ${totalBatches}...`;
    }
    if (isCompleted) {
      return "Resumen de sentencias SQL aplicadas en PostgreSQL";
    }
    return "Autentique y ejecute las sentencias en bloques de 500 registros.";
  };

  return (
    <div className={styles.modalHeader}>
      <div className={styles.titleGroup}>
        <div className={`${styles.headerIcon} ${getHeaderIconClass()}`}>
          {isExecuting ? (
            <Loader2 size={22} className={styles.spin} />
          ) : isCompleted ? (
            result?.success ? (
              <CheckCircle2 size={22} />
            ) : (
              <AlertTriangle size={22} />
            )
          ) : (
            <Database size={22} />
          )}
        </div>
        <div>
          <h3 className={styles.title}>{getTitle()}</h3>
          <p className={styles.subtitle}>{getSubtitle()}</p>
        </div>
      </div>

      {!isExecuting && (
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Cerrar modal"
        >
          <X size={18} />
        </button>
      )}
    </div>
  );
};
