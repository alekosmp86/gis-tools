import React from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { ProgressBar } from "@/ui-kit/components/ProgressBar";
import { AlertType } from "@/ui-kit/types/ui";
import { FullReplaceRunStatus, reset } from "@/core/services/fullReplaceRunStore";
import { FullReplaceSummary } from "./FullReplaceSummary";
import { useFullReplaceRun } from "./useFullReplaceRun";
import styles from "./FullReplaceRunPanel.module.css";

export const FullReplaceRunPanel: React.FC = () => {
  const { status, progress, result, error, context } = useFullReplaceRun();
  if (!context) return null;

  const isRunning = status === FullReplaceRunStatus.RUNNING;
  const progressPct =
    progress && progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <AlertTriangle size={36} className={styles.headerIcon} />
        <div className={styles.headerContent}>
          <span className={styles.title}>
            {isRunning ? "Reemplazo completo en curso" : "Reemplazo completo finalizado"}
          </span>
          <span className={styles.label}>Tabla destino</span>
          <span className={styles.server}>{context.targetServer}</span>
          <span className={styles.table}>{context.targetLabel}</span>
          <span className={styles.label}>Tabla origen</span>
          <span className={styles.server}>{context.sourceServer}</span>
          <span className={styles.table}>{context.sourceLabel}</span>
        </div>
      </div>

      {isRunning && (
        <div className={styles.notice}>
          <ShieldAlert size={18} className={styles.noticeIcon} />
          <span>
            Salir de esta página no detiene el reemplazo: continúa en segundo plano y podrá ver su avance al volver.
            Cerrar o recargar la pestaña sí lo interrumpe y puede dejar la tabla destino parcialmente cargada.
          </span>
        </div>
      )}

      {isRunning && (
        <ProgressBar
          phase={progress?.label ?? "Iniciando reemplazo..."}
          current={progress?.current ?? 0}
          total={progress?.total ?? 0}
          pct={progressPct}
        />
      )}

      {error && <AlertMessage type={AlertType.ERROR} text={error} />}

      {result && <FullReplaceSummary result={result} />}

      {!isRunning && (
        <div className={styles.actions}>
          <Button type="button" onClick={reset}>
            Cerrar
          </Button>
        </div>
      )}
    </div>
  );
};
