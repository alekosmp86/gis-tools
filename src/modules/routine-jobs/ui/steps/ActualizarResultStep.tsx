"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import { ActualizarPadronReport } from "../ActualizarPadronReport";
import type { ActualizarPadronRunSnapshot } from "../actualizarPadronRunStore";
import { RunPhase } from "../jobRunStore";
import { RunProgressStatus, RunResultActions } from "./RunResultParts";
import { RunStepChecklist } from "./RunStepChecklist";
import styles from "./WizardSteps.module.css";

const IDLE_HINT = "Todavía no hay una actualización. Complete los pasos anteriores y pulse Analizar sin cargar o Actualizar padrones.";
const NO_REPORT_MESSAGE = "La actualización terminó, pero el servidor no envió el informe.";
const FAILED_FALLBACK = "La actualización terminó con un error.";
const UNKNOWN_TITLE = "No se pudo confirmar el resultado de la actualización.";
const UNKNOWN_ADVICE = "Hay que verificar la tabla de destino antes de volver a actualizar.";

export interface ActualizarResultStepProps {
  snapshot: ActualizarPadronRunSnapshot;
  nowMs: number;
  onNewRun: () => void;
  onBackToReview: () => void;
}

const textOr = (value: string | undefined, fallback: string): string =>
  value !== undefined && value.trim() !== "" ? value : fallback;

function OutcomeChecklist({ snapshot }: { snapshot: ActualizarPadronRunSnapshot }) {
  return (
    <RunStepChecklist
      plan={snapshot.plan}
      steps={snapshot.job?.steps}
      currentLabel={snapshot.job?.step || null}
      phase={snapshot.phase}
    />
  );
}

function DoneBody({ snapshot }: { snapshot: ActualizarPadronRunSnapshot }) {
  const result = snapshot.job?.result;
  return result ? (
    <ActualizarPadronReport result={result} />
  ) : (
    <AlertMessage type={AlertType.WARNING} text={NO_REPORT_MESSAGE} />
  );
}

function UnknownBody({ snapshot }: { snapshot: ActualizarPadronRunSnapshot }) {
  return (
    <>
      <AlertMessage type={AlertType.ERROR} text={UNKNOWN_TITLE} />
      <p className={styles.hint}>{`Identificador del trabajo: ${snapshot.jobId ?? "no disponible"}. ${UNKNOWN_ADVICE}`}</p>
      <OutcomeChecklist snapshot={snapshot} />
    </>
  );
}

function FailedBody({ snapshot }: { snapshot: ActualizarPadronRunSnapshot }) {
  return (
    <>
      <AlertMessage type={AlertType.ERROR} text={textOr(snapshot.error, FAILED_FALLBACK)} />
      <OutcomeChecklist snapshot={snapshot} />
    </>
  );
}

export const ActualizarResultStep: React.FC<ActualizarResultStepProps> = ({ snapshot, nowMs, onNewRun, onBackToReview }) => {
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
    case RunPhase.DONE:
      return (
        <div className={styles.stack}>
          <DoneBody snapshot={snapshot} />
          {actions}
        </div>
      );
    case RunPhase.FAILED:
      return (
        <div className={styles.stack}>
          <FailedBody snapshot={snapshot} />
          {actions}
        </div>
      );
    case RunPhase.UNKNOWN:
      return (
        <div className={styles.stack}>
          <UnknownBody snapshot={snapshot} />
          {actions}
        </div>
      );
  }
};
