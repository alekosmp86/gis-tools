"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import { UnidadTerritorialReport } from "../UnidadTerritorialReport";
import { RunPhase } from "../jobRunStore";
import type { UnidadRunSnapshot } from "../unidadTerritorialRunStore";
import { RunResultActions } from "./RunResultParts";
import styles from "./WizardSteps.module.css";

const IDLE_HINT = "Todavía no hay un informe. Ejecute una actualización desde el paso Revisar.";
const RUNNING_HINT = "La actualización sigue en curso. El informe aparece cuando termine.";
const NO_REPORT_MESSAGE = "La actualización terminó, pero el servidor no envió el informe.";
const NOT_FINISHED_MESSAGE = "La actualización no terminó correctamente, así que no hay informe. Revise el paso Ejecución.";

export interface UnidadReportStepProps {
  snapshot: UnidadRunSnapshot;
  onNewRun: () => void;
  onBackToReview: () => void;
}

export const UnidadReportStep: React.FC<UnidadReportStepProps> = ({ snapshot, onNewRun, onBackToReview }) => {
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
            <UnidadTerritorialReport result={result} />
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
