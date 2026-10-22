import React from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { ProgressBar } from "@/ui-kit/components/ProgressBar";
import { AlertType } from "@/ui-kit/types/ui";
import { ShpReplaceRunStatus, reset } from "@/core/services/shpReplaceRunStore";
import { ShpReplaceSummary } from "./ShpReplaceSummary";
import { useShpReplaceRun } from "./useShpReplaceRun";
import {
  SHP_REPLACE_PHASE_LABELS,
  SHP_REPLACE_STARTING_PHASE_LABEL,
  SHP_REPLACE_TITLE_BY_STATUS,
  SHP_REPLACE_UPLOAD_PHASE_LABEL,
} from "./shpReplaceLabels";
import styles from "./ShpReplaceRunPanel.module.css";

const toPercent = (current: number, total: number): number =>
  total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

const UNMODIFIED_TARGET_TEXT =
  "La tabla destino no fue modificada: el reemplazo se ejecuta en una sola transacción y se revierte ante cualquier error.";
const UNKNOWN_OUTCOME_TEXT =
  "Estado desconocido: el servidor puede seguir trabajando o haber confirmado el reemplazo. Verifique el contenido de la tabla destino antes de reintentar.";

interface FailureNoticeProps {
  error: string | null;
  outcomeUnknown: boolean;
  jobId: string | null;
}

const FailureNotice: React.FC<FailureNoticeProps> = ({ error, outcomeUnknown, jobId }) => (
  <>
    {error && <AlertMessage type={AlertType.ERROR} text={error} />}
    {outcomeUnknown ? (
      <AlertMessage type={AlertType.WARNING} text={`${UNKNOWN_OUTCOME_TEXT} Trabajo: ${jobId ?? "desconocido"}.`} />
    ) : (
      <AlertMessage type={AlertType.WARNING} text={UNMODIFIED_TARGET_TEXT} />
    )}
  </>
);

export const ShpReplaceRunPanel: React.FC = () => {
  const { status, uploadPct, phase, current, total, result, error, context, outcomeUnknown, jobId } = useShpReplaceRun();
  if (!context) return null;

  const isUploading = status === ShpReplaceRunStatus.UPLOADING;
  const isRunning = status === ShpReplaceRunStatus.RUNNING;
  const isFailed = status === ShpReplaceRunStatus.FAILED;
  const isBusy = isUploading || isRunning;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <AlertTriangle size={36} className={styles.headerIcon} />
        <div className={styles.headerContent}>
          <span className={styles.title}>{SHP_REPLACE_TITLE_BY_STATUS[status]}</span>
          <span className={styles.label}>Tabla destino</span>
          <span className={styles.server}>{context.targetServer}</span>
          <span className={styles.table}>{context.targetLabel}</span>
          <span className={styles.label}>Archivo</span>
          <span className={styles.server}>{context.fileName}</span>
        </div>
      </div>

      {isUploading && (
        <div className={styles.notice}>
          <ShieldAlert size={18} className={styles.noticeIcon} />
          <span>Cerrar o recargar la pestaña mientras se sube el archivo cancela el reemplazo.</span>
        </div>
      )}

      {isRunning && (
        <div className={styles.notice}>
          <ShieldAlert size={18} className={styles.noticeIcon} />
          <span>
            Cambiar de sección no detiene el reemplazo. Si recarga o cierra la pestaña, el servidor completa o revierte la
            carga, pero deja de verse su avance.
          </span>
        </div>
      )}

      {isUploading && (
        <ProgressBar phase={SHP_REPLACE_UPLOAD_PHASE_LABEL} current={0} total={0} pct={uploadPct} />
      )}

      {isRunning && (
        <ProgressBar
          phase={phase ? SHP_REPLACE_PHASE_LABELS[phase] : SHP_REPLACE_STARTING_PHASE_LABEL}
          current={current}
          total={total}
          pct={toPercent(current, total)}
        />
      )}

      {isFailed && <FailureNotice error={error} outcomeUnknown={outcomeUnknown} jobId={jobId} />}

      {result && <ShpReplaceSummary result={result} />}

      {!isBusy && (
        <div className={styles.actions}>
          <Button type="button" onClick={reset}>
            Nueva operación
          </Button>
        </div>
      )}
    </div>
  );
};
