"use client";

import React from "react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import { formatElapsed } from "../elapsedTime";
import { RunPhase } from "../jobRunStore";
import { RunStepChecklist } from "./RunStepChecklist";
import type { RunPlan } from "../stepChecklist";
import styles from "./WizardSteps.module.css";

const STARTING_LABEL = "Iniciando la carga...";
const PREPARING_LABEL = "Preparando la carga...";
const NEW_RUN_LABEL = "Nueva carga";
const BACK_TO_REVIEW_LABEL = "Volver a Revisar";

export interface RunProgressStatusProps {
  phase: RunPhase;
  startedAt?: number;
  nowMs: number;
  plan?: RunPlan;
  steps?: readonly string[];
  currentLabel: string | null;
}

export const RunProgressStatus: React.FC<RunProgressStatusProps> = ({ phase, startedAt, nowMs, plan, steps, currentLabel }) => {
  const waitingLabel = phase === RunPhase.STARTING ? STARTING_LABEL : PREPARING_LABEL;
  return (
    <div className={styles.stack}>
      <div className={styles.statusRow}>
        {currentLabel === null && <span className={styles.statusStep}>{waitingLabel}</span>}
        {startedAt !== undefined && (
          <span className={styles.statusCounter}>{`Tiempo transcurrido ${formatElapsed(nowMs - startedAt)}`}</span>
        )}
      </div>
      <RunStepChecklist plan={plan} steps={steps} currentLabel={currentLabel} phase={phase} />
    </div>
  );
};

export interface RunResultActionsProps {
  onNewRun: () => void;
  onBackToReview: () => void;
}

export const RunResultActions: React.FC<RunResultActionsProps> = ({ onNewRun, onBackToReview }) => (
  <div className={styles.actions}>
    <Button variant={ButtonVariant.SECONDARY} onClick={onBackToReview}>
      <span>{BACK_TO_REVIEW_LABEL}</span>
    </Button>
    <Button variant={ButtonVariant.SECONDARY} onClick={onNewRun}>
      <span>{NEW_RUN_LABEL}</span>
    </Button>
  </div>
);
