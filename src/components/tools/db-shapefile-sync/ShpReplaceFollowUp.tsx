import React, { useState } from "react";
import { Lock, RotateCcw, Trash2, Wrench } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { GeometryProcessingOptions, GeometryProcessingReport } from "@/core/types/geometryProcessing";
import { isReplaceBlocked, shouldOfferRepair } from "@/core/services/geometryReportNotices";
import { ShpNewOperationButton, ShpRunFooter } from "./ShpRunFooter";
import styles from "./ShpReplaceFollowUp.module.css";

export interface ShpRerunRequest {
  password: string;
  processing: GeometryProcessingOptions;
  dryRun: boolean;
}

export interface ShpReplaceFollowUpProps {
  report: GeometryProcessingReport;
  processing: GeometryProcessingOptions;
  targetLabel: string;
  canReplace: boolean;
  onRerun: (request: ShpRerunRequest) => void;
  onReconfigure: () => void;
  onNewOperation: () => void;
}

const REPAIR_PROMPT_TEXT = "Hay geometrías inválidas y la reparación está desactivada.";
const REPAIR_PROMPT_HINT = "Sin reparar, se insertarán tal como están y quedará un aviso visible.";

export const ShpReplaceFollowUp: React.FC<ShpReplaceFollowUpProps> = ({
  report,
  processing,
  targetLabel,
  canReplace,
  onRerun,
  onReconfigure,
  onNewOperation,
}) => {
  const [password, setPassword] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [isRepairPromptDismissed, setRepairPromptDismissed] = useState(false);

  const hasPassword = password.trim() !== "";
  const canRerun = canReplace && hasPassword && confirmValue === targetLabel && !isReplaceBlocked(report);
  const showRepairPrompt = canReplace && shouldOfferRepair(report, processing) && !isRepairPromptDismissed;

  const submit = (request: ShpRerunRequest) => {
    setPassword("");
    onRerun(request);
  };

  return (
    <div className={styles.container}>
      {showRepairPrompt && (
        <div className={styles.prompt}>
          <div className={styles.promptText}>
            <Wrench size={18} className={styles.promptIcon} />
            <div className={styles.promptContent}>
              <span className={styles.promptTitle}>¿Reparar?</span>
              <span>{REPAIR_PROMPT_TEXT}</span>
              <span className={styles.promptHint}>{REPAIR_PROMPT_HINT}</span>
            </div>
          </div>
          <div className={styles.promptActions}>
            <Button
              type="button"
              variant={ButtonVariant.SECONDARY}
              className={styles.promptAction}
              onClick={() => setRepairPromptDismissed(true)}
            >
              Continuar sin reparar
            </Button>
            <Button
              type="button"
              className={styles.promptAction}
              disabled={!hasPassword}
              onClick={() =>
                submit({ password, processing: { ...processing, repair: { enabled: true } }, dryRun: true })
              }
            >
              Activar reparación y volver a analizar
            </Button>
          </div>
        </div>
      )}

      {canReplace && (
        <div className={styles.replaceBox}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              <Lock size={14} />
              Contraseña de PostgreSQL del destino
            </span>
            <input
              type="password"
              className={styles.input}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Para confirmar el reemplazo, escriba <code className={styles.code}>{targetLabel}</code>
            </span>
            <input
              type="text"
              className={styles.input}
              value={confirmValue}
              onChange={(event) => setConfirmValue(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>
      )}

      <ShpRunFooter
        leading={<ShpNewOperationButton onClick={onNewOperation} />}
        trailing={
          <>
            <Button type="button" variant={ButtonVariant.SECONDARY} onClick={onReconfigure}>
              <RotateCcw size={16} />
              <span>Volver a configurar</span>
            </Button>
            {canReplace && (
              <Button
                type="button"
                className={styles.dangerButton}
                disabled={!canRerun}
                onClick={() => submit({ password, processing, dryRun: false })}
              >
                <Trash2 size={16} />
                <span>Reemplazar ahora</span>
              </Button>
            )}
          </>
        }
      />
    </div>
  );
};
