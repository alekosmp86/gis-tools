"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import type { CargarPadronesRunSnapshot } from "../cargarPadronesRunStore";
import { CargarPadronesReport } from "../CargarPadronesReport";
import { RunStepChecklist } from "./RunStepChecklist";
import { RunProgressStatus, RunResultActions } from "./RunResultParts";
import styles from "./WizardSteps.module.css";

const IDLE_HINT = "Todavía no hay una carga. Complete los pasos anteriores y pulse Analizar sin cargar o Cargar ahora.";
const NO_REPORT_MESSAGE = "La carga terminó, pero el servidor no envió el informe.";
const FAILED_FALLBACK = "La carga terminó con un error.";
const UNKNOWN_TITLE = "No se pudo confirmar el resultado de la carga.";
const UNKNOWN_ADVICE = "Revise la tabla destino antes de volver a cargar.";

export interface ResultStepProps {
  snapshot: CargarPadronesRunSnapshot;
  nowMs: number;
  onNewRun: () => void;
  onBackToReview: () => void;
}

const textOr = (value: string | undefined, fallback: string): string =>
  value !== undefined && value.trim() !== "" ? value : fallback;

function RunProgress({ snapshot, nowMs }: { snapshot: CargarPadronesRunSnapshot; nowMs: number }) {
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
          <RunResultActions onNewRun={onNewRun} onBackToReview={onBackToReview} />
        </div>
      );
    }
    case "failed":
      return (
        <div className={styles.stack}>
          <AlertMessage type={AlertType.ERROR} text={textOr(snapshot.error, FAILED_FALLBACK)} />
          <RunOutcomeChecklist snapshot={snapshot} />
          <RunResultActions onNewRun={onNewRun} onBackToReview={onBackToReview} />
        </div>
      );
    case "unknown":
      return (
        <div className={styles.stack}>
          <AlertMessage type={AlertType.ERROR} text={UNKNOWN_TITLE} />
          <p className={styles.hint}>{`Identificador del trabajo: ${snapshot.jobId ?? "no disponible"}. ${UNKNOWN_ADVICE}`}</p>
          <RunOutcomeChecklist snapshot={snapshot} />
          <RunResultActions onNewRun={onNewRun} onBackToReview={onBackToReview} />
        </div>
      );
  }
};
