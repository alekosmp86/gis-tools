"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import { CargarPadronesRunPhase, type CargarPadronesRunSnapshot } from "../cargarPadronesRunStore";
import { CargarPadronesReport } from "../CargarPadronesReport";
import { RunStepChecklist } from "./RunStepChecklist";
import styles from "./WizardSteps.module.css";

const IDLE_HINT = "Todavía no hay una carga. Complete los pasos anteriores y pulse Analizar sin cargar o Cargar ahora.";
const STARTING_LABEL = "Iniciando la carga...";
const PREPARING_LABEL = "Preparando la carga...";
const NO_REPORT_MESSAGE = "La carga terminó, pero el servidor no envió el informe.";
const FAILED_FALLBACK = "La carga terminó con un error.";
const UNKNOWN_TITLE = "No se pudo confirmar el resultado de la carga.";
const UNKNOWN_ADVICE = "Revise la tabla destino antes de volver a cargar.";
const NEW_RUN_LABEL = "Nueva carga";
const BACK_TO_REVIEW_LABEL = "Volver a Revisar";
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const CLOCK_PAD_LENGTH = 2;

export interface ResultStepProps {
  snapshot: CargarPadronesRunSnapshot;
  nowMs: number;
  onNewRun: () => void;
  onBackToReview: () => void;
}

const pad = (value: number): string => String(value).padStart(CLOCK_PAD_LENGTH, "0");

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / MS_PER_SECOND));
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  const clock = `${pad(minutes)}:${pad(seconds)}`;
  return hours > 0 ? `${hours}:${clock}` : clock;
}

const textOr = (value: string | undefined, fallback: string): string =>
  value !== undefined && value.trim() !== "" ? value : fallback;

function RunProgress({ snapshot, nowMs }: { snapshot: CargarPadronesRunSnapshot; nowMs: number }) {
  const startedAt = snapshot.startedAt ?? snapshot.job?.startedAt;
  const currentLabel = snapshot.job?.step || null;
  const waitingLabel = snapshot.phase === CargarPadronesRunPhase.STARTING ? STARTING_LABEL : PREPARING_LABEL;

  return (
    <div className={styles.stack}>
      <div className={styles.statusRow}>
        {currentLabel === null && <span className={styles.statusStep}>{waitingLabel}</span>}
        {startedAt !== undefined && (
          <span className={styles.statusCounter}>{`Tiempo transcurrido ${formatElapsed(nowMs - startedAt)}`}</span>
        )}
      </div>
      <RunStepChecklist plan={snapshot.plan} steps={snapshot.job?.steps} currentLabel={currentLabel} phase={snapshot.phase} />
    </div>
  );
}

function RunOutcomeChecklist({ snapshot }: { snapshot: CargarPadronesRunSnapshot }) {
  return (
    <RunStepChecklist
      plan={snapshot.plan}
      steps={snapshot.job?.steps}
      currentLabel={snapshot.job?.step || null}
      phase={snapshot.phase}
    />
  );
}

function NewRunAction({ onNewRun, onBackToReview }: { onNewRun: () => void; onBackToReview: () => void }) {
  return (
    <div className={styles.actions}>
      <Button variant={ButtonVariant.SECONDARY} onClick={onBackToReview}>
        <span>{BACK_TO_REVIEW_LABEL}</span>
      </Button>
      <Button variant={ButtonVariant.SECONDARY} onClick={onNewRun}>
        <span>{NEW_RUN_LABEL}</span>
      </Button>
    </div>
  );
}

export const ResultStep: React.FC<ResultStepProps> = ({ snapshot, nowMs, onNewRun, onBackToReview }) => {
  switch (snapshot.phase) {
    case "idle":
      return <p className={styles.hint}>{IDLE_HINT}</p>;
    case "starting":
    case "running":
      return <RunProgress snapshot={snapshot} nowMs={nowMs} />;
    case "done": {
      const result = snapshot.job?.result;
      return (
        <div className={styles.stack}>
          {result ? (
            <CargarPadronesReport result={result} />
          ) : (
            <AlertMessage type={AlertType.WARNING} text={NO_REPORT_MESSAGE} />
          )}
          <NewRunAction onNewRun={onNewRun} onBackToReview={onBackToReview} />
        </div>
      );
    }
    case "failed":
      return (
        <div className={styles.stack}>
          <AlertMessage type={AlertType.ERROR} text={textOr(snapshot.error, FAILED_FALLBACK)} />
          <RunOutcomeChecklist snapshot={snapshot} />
          <NewRunAction onNewRun={onNewRun} onBackToReview={onBackToReview} />
        </div>
      );
    case "unknown":
      return (
        <div className={styles.stack}>
          <AlertMessage type={AlertType.ERROR} text={UNKNOWN_TITLE} />
          <p className={styles.hint}>{`Identificador del trabajo: ${snapshot.jobId ?? "no disponible"}. ${UNKNOWN_ADVICE}`}</p>
          <RunOutcomeChecklist snapshot={snapshot} />
          <NewRunAction onNewRun={onNewRun} onBackToReview={onBackToReview} />
        </div>
      );
  }
};
