"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import { EjesCallesReport } from "../EjesCallesReport";
import type { EjesRunSnapshot } from "../ejesCallesRunStore";
import { RunPhase } from "../jobRunStore";
import { RunProgressStatus, RunResultActions } from "./RunResultParts";
import { RunStepChecklist } from "./RunStepChecklist";
import styles from "./WizardSteps.module.css";

const IDLE_HINT = "Todavía no hay un análisis. Complete los pasos anteriores y pulse Analizar.";
const NO_REPORT_MESSAGE = "El análisis terminó, pero el servidor no envió el informe.";
const FAILED_FALLBACK = "El trabajo de ejes de calles terminó con un error.";
const UNKNOWN_TITLE = "No se pudo confirmar el resultado del trabajo de ejes de calles.";
const UNKNOWN_ADVICE = "Hay que verificar las tablas de ejes de calles antes de volver a cargar.";

export interface EjesResultStepProps {
  snapshot: EjesRunSnapshot;
  nowMs: number;
  onNewRun: () => void;
  onBackToReview: () => void;
}

const textOr = (value: string | undefined, fallback: string): string =>
  value !== undefined && value.trim() !== "" ? value : fallback;

function Checklist({ snapshot }: { snapshot: EjesRunSnapshot }) {
  return (
    <RunStepChecklist
      plan={snapshot.plan}
      steps={snapshot.job?.steps}
      currentLabel={snapshot.job?.step || null}
      phase={snapshot.phase}
    />
  );
}

export const EjesResultStep: React.FC<EjesResultStepProps> = ({ snapshot, nowMs, onNewRun, onBackToReview }) => {
  const actions = <RunResultActions onNewRun={onNewRun} onBackToReview={onBackToReview} />;
  switch (snapshot.phase) {
    case RunPhase.IDLE:
      return <p className={styles.hint}>{IDLE_HINT}</p>;
    case RunPhase.STARTING:
    case RunPhase.RUNNING:
      return (
        <RunProgressStatus
          phase={snapshot.phase}
          startedAt={snapshot.startedAt ?? snapshot.job?.startedAt}
          nowMs={nowMs}
          plan={snapshot.plan}
          steps={snapshot.job?.steps}
          currentLabel={snapshot.job?.step || null}
        />
      );
    case RunPhase.DONE: {
      const result = snapshot.job?.result;
      return (
        <div className={styles.stack}>
          {result ? <EjesCallesReport result={result} /> : <AlertMessage type={AlertType.WARNING} text={NO_REPORT_MESSAGE} />}
          {actions}
        </div>
      );
    }
    case RunPhase.FAILED:
      return (
        <div className={styles.stack}>
          <AlertMessage type={AlertType.ERROR} text={textOr(snapshot.error, FAILED_FALLBACK)} />
          <Checklist snapshot={snapshot} />
          {actions}
        </div>
      );
    case RunPhase.UNKNOWN:
      return (
        <div className={styles.stack}>
          <AlertMessage type={AlertType.ERROR} text={UNKNOWN_TITLE} />
          <p className={styles.hint}>{`Identificador del trabajo: ${snapshot.jobId ?? "no disponible"}. ${UNKNOWN_ADVICE}`}</p>
          <Checklist snapshot={snapshot} />
          {actions}
        </div>
      );
  }
};
