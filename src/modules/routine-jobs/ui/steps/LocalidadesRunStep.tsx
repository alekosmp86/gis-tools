"use client";

import React from "react";
import { ChartColumn } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType } from "@/ui-kit/types/ui";
import type { CargarLocalidadesRunSnapshot } from "../cargarLocalidadesRunStore";
import { RunPhase } from "../jobRunStore";
import { RunProgressStatus, RunResultActions } from "./RunResultParts";
import { RunStepChecklist } from "./RunStepChecklist";
import styles from "./WizardSteps.module.css";

const IDLE_HINT =
  "Todavía no hay una carga de localidades. Complete los pasos anteriores y pulse Analizar sin cargar o Cargar localidades.";
const DRY_RUN_DONE = "Análisis terminado: las tablas de localidades no fueron modificadas.";
const REAL_RUN_DONE = "Carga terminada. Revise el informe.";
const FAILED_FALLBACK = "La carga de localidades terminó con un error.";
const UNKNOWN_TITLE = "No se pudo confirmar el resultado de la carga de localidades.";
const UNKNOWN_ADVICE = "Hay que verificar las tablas de localidades antes de volver a cargar.";
const SEE_REPORT_LABEL = "Ver informe";

export interface LocalidadesRunStepProps {
  snapshot: CargarLocalidadesRunSnapshot;
  nowMs: number;
  onNewRun: () => void;
  onBackToReview: () => void;
  onOpenReport: () => void;
}

const textOr = (value: string | undefined, fallback: string): string =>
  value !== undefined && value.trim() !== "" ? value : fallback;

function OutcomeChecklist({ snapshot }: { snapshot: CargarLocalidadesRunSnapshot }) {
  return (
    <RunStepChecklist
      plan={snapshot.plan}
      steps={snapshot.job?.steps}
      currentLabel={snapshot.job?.step || null}
      phase={snapshot.phase}
    />
  );
}

function DoneBody({ snapshot, onOpenReport }: { snapshot: CargarLocalidadesRunSnapshot; onOpenReport: () => void }) {
  const isDryRun = snapshot.plan?.dryRun ?? false;
  return (
    <>
      <AlertMessage type={AlertType.SUCCESS} text={isDryRun ? DRY_RUN_DONE : REAL_RUN_DONE} />
      <OutcomeChecklist snapshot={snapshot} />
      <div className={styles.actions}>
        <Button onClick={onOpenReport}>
          <ChartColumn size={15} />
          <span>{SEE_REPORT_LABEL}</span>
        </Button>
      </div>
    </>
  );
}

function UnknownBody({ snapshot }: { snapshot: CargarLocalidadesRunSnapshot }) {
  return (
    <>
      <AlertMessage type={AlertType.ERROR} text={UNKNOWN_TITLE} />
      <p className={styles.hint}>{`Identificador del trabajo: ${snapshot.jobId ?? "no disponible"}. ${UNKNOWN_ADVICE}`}</p>
      <OutcomeChecklist snapshot={snapshot} />
    </>
  );
}

function FailedBody({ snapshot }: { snapshot: CargarLocalidadesRunSnapshot }) {
  return (
    <>
      <AlertMessage type={AlertType.ERROR} text={textOr(snapshot.error, FAILED_FALLBACK)} />
      <OutcomeChecklist snapshot={snapshot} />
    </>
  );
}

export const LocalidadesRunStep: React.FC<LocalidadesRunStepProps> = ({
  snapshot,
  nowMs,
  onNewRun,
  onBackToReview,
  onOpenReport,
}) => {
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
          <DoneBody snapshot={snapshot} onOpenReport={onOpenReport} />
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
