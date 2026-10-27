"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import { CargarLocalidadesReport } from "../CargarLocalidadesReport";
import type { CargarLocalidadesRunSnapshot } from "../cargarLocalidadesRunStore";
import { RunPhase } from "../jobRunStore";
import { RunResultActions } from "./RunResultParts";
import styles from "./WizardSteps.module.css";

const IDLE_HINT = "Todavía no hay un informe. Ejecute una carga desde el paso Revisar.";
const RUNNING_HINT = "La carga sigue en curso. El informe aparece cuando termine.";
const NO_REPORT_MESSAGE = "La carga terminó, pero el servidor no envió el informe.";
const NOT_FINISHED_MESSAGE = "La carga no terminó correctamente, así que no hay informe. Revise el paso Ejecución.";

export interface LocalidadesReportStepProps {
  snapshot: CargarLocalidadesRunSnapshot;
  onNewRun: () => void;
  onBackToReview: () => void;
}

export const LocalidadesReportStep: React.FC<LocalidadesReportStepProps> = ({ snapshot, onNewRun, onBackToReview }) => {
  const actions = <RunResultActions onNewRun={onNewRun} onBackToReview={onBackToReview} />;
  switch (snapshot.phase) {
    case RunPhase.IDLE:
      return <p className={styles.hint}>{IDLE_HINT}</p>;
    case RunPhase.STARTING:
    case RunPhase.RUNNING:
      return <p className={styles.hint}>{RUNNING_HINT}</p>;
    case RunPhase.DONE: {
      const result = snapshot.job?.result;
      return (
        <div className={styles.stack}>
          {result ? (
            <CargarLocalidadesReport result={result} />
          ) : (
            <AlertMessage type={AlertType.WARNING} text={NO_REPORT_MESSAGE} />
          )}
          {actions}
        </div>
      );
    }
    case RunPhase.FAILED:
    case RunPhase.UNKNOWN:
      return (
        <div className={styles.stack}>
          <AlertMessage type={AlertType.WARNING} text={NOT_FINISHED_MESSAGE} />
          {actions}
        </div>
      );
  }
};
