"use client";

import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { REMOVAL_LABELS } from "../data/removalLabels";
import { RemovalPhase } from "../removalConstants";
import { DedupRemovalForm } from "./DedupRemovalForm";
import { DedupRemovalPlanView } from "./DedupRemovalPlanView";
import { DedupRemovalResultView } from "./DedupRemovalResultView";
import type { DedupRemovalFlow } from "./useDedupRemoval";
import styles from "./DedupRemovalDialog.module.css";

interface DedupRemovalDialogProps {
  flow: DedupRemovalFlow;
}

const FORM_PHASES: ReadonlyArray<RemovalPhase> = [RemovalPhase.FORM, RemovalPhase.SIMULATING];
const PLAN_PHASES: ReadonlyArray<RemovalPhase> = [RemovalPhase.REVIEW, RemovalPhase.EXECUTING];

export const DedupRemovalDialog: React.FC<DedupRemovalDialogProps> = ({ flow }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { state } = flow;
  const isOpen = state.phase !== RemovalPhase.CLOSED;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  const handleCancel = (event: React.SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    flow.close();
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="dedup-removal-title"
      onCancel={handleCancel}
    >
      {isOpen && (
        <div className={styles.content}>
          <header className={styles.header}>
            <h2 id="dedup-removal-title" className={styles.title}>
              {REMOVAL_LABELS.DIALOG_TITLE}
            </h2>
            <button
              type="button"
              className={styles.close}
              aria-label={REMOVAL_LABELS.CLOSE_BUTTON}
              disabled={flow.isBusy}
              onClick={flow.close}
            >
              <X size={16} />
            </button>
          </header>

          {FORM_PHASES.includes(state.phase) && (
            <DedupRemovalForm
              responsable={state.responsable}
              motivo={state.motivo}
              isSimulating={state.phase === RemovalPhase.SIMULATING}
              canSimulate={flow.canSimulate}
              errorText={state.error}
              onResponsableChange={flow.setResponsable}
              onMotivoChange={flow.setMotivo}
              onSimulate={flow.simulate}
            />
          )}

          {PLAN_PHASES.includes(state.phase) && state.plan && (
            <DedupRemovalPlanView
              plan={state.plan}
              provinceId={flow.provinceId}
              errorText={state.error}
              isExecuting={state.phase === RemovalPhase.EXECUTING}
              canExecute={flow.canExecute}
              onRestart={flow.restart}
              onExecute={flow.execute}
            />
          )}

          {state.phase === RemovalPhase.DONE && state.result && (
            <DedupRemovalResultView result={state.result} onClose={flow.close} />
          )}
        </div>
      )}
    </dialog>
  );
};
