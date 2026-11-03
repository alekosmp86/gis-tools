"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import { ActualizarPadronReport } from "../ActualizarPadronReport";
import type { GeometryMapBase } from "../clientTypes";
import type { PairChoiceSelection } from "../PairChoiceGroups";
import type { GeometryAcceptSelection } from "../reviewDecisions";
import type { ActualizarPadronRunSnapshot } from "../actualizarPadronRunStore";
import { AUTO_ANALYSIS_LABEL } from "../actualizarPersistFlow";
import { persistSummaryOf } from "../actualizarPersistSummary";
import { RunPhase } from "../jobRunStore";
import { ActualizarPersistPanel, type ActualizarPersistState } from "./ActualizarPersistPanel";
import { RunProgressStatus, RunResultActions } from "./RunResultParts";
import { RunStepChecklist } from "./RunStepChecklist";
import styles from "./WizardSteps.module.css";

const IDLE_HINT = "Todavía no hay una actualización. Complete los pasos anteriores y pulse Analizar.";
const NO_REPORT_MESSAGE = "La actualización terminó, pero el servidor no envió el informe.";
const FAILED_FALLBACK = "La actualización terminó con un error.";
const UNKNOWN_TITLE = "No se pudo confirmar el resultado de la actualización.";
const UNKNOWN_ADVICE = "Hay que verificar la tabla de destino antes de volver a actualizar.";
const RETRY_ANALYSIS_LABEL = "Volver a analizar";
const AWAITING_PHASES: readonly RunPhase[] = [RunPhase.STARTING, RunPhase.RUNNING, RunPhase.DONE];

export interface ActualizarResultStepProps {
  snapshot: ActualizarPadronRunSnapshot;
  nowMs: number;
  pairChoices: PairChoiceSelection;
  geometryAccepts: GeometryAcceptSelection;
  mapBase: GeometryMapBase | null;
  persist: ActualizarPersistState;
  autoAnalysis: boolean;
  onNewRun: () => void;
  onBackToReview: () => void;
}

function AutoAnalysisBody({ snapshot, nowMs }: { snapshot: ActualizarPadronRunSnapshot; nowMs: number }) {
  return (
    <div className={styles.stack}>
      <p className={styles.hint}>{AUTO_ANALYSIS_LABEL}</p>
      {snapshot.phase !== RunPhase.DONE && (
        <RunProgressStatus
          phase={snapshot.phase}
          startedAt={snapshot.startedAt ?? snapshot.job?.startedAt}
          nowMs={nowMs}
          plan={snapshot.plan}
          steps={snapshot.job?.steps}
          currentLabel={snapshot.job?.step || null}
        />
      )}
    </div>
  );
}

const textOr = (value: string | undefined, fallback: string): string =>
  value !== undefined && value.trim() !== "" ? value : fallback;

/** A refused persist (missing, expired or changed plan) is answered by a new analysis, not by a review of the same plan. */
const backLabelOf = (snapshot: ActualizarPadronRunSnapshot): string | undefined =>
  snapshot.phase === RunPhase.FAILED && snapshot.plan?.dryRun === false ? RETRY_ANALYSIS_LABEL : undefined;

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

function PersistSection({ snapshot, persist }: { snapshot: ActualizarPadronRunSnapshot; persist: ActualizarPersistState }) {
  const result = snapshot.job?.result;
  if (result === undefined || !result.dryRun) return null;
  return <ActualizarPersistPanel summary={persistSummaryOf(result.target)} {...persist} />;
}

type DoneBodyProps = Pick<ActualizarResultStepProps, "snapshot" | "pairChoices" | "geometryAccepts" | "mapBase">;

function DoneBody({ snapshot, ...decisions }: DoneBodyProps) {
  const result = snapshot.job?.result;
  return result ? (
    <ActualizarPadronReport result={result} {...decisions} />
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

export const ActualizarResultStep: React.FC<ActualizarResultStepProps> = ({
  snapshot,
  nowMs,
  pairChoices,
  geometryAccepts,
  mapBase,
  persist,
  autoAnalysis,
  onNewRun,
  onBackToReview,
}) => {
  const actions = (
    <RunResultActions onNewRun={onNewRun} onBackToReview={onBackToReview} backLabel={backLabelOf(snapshot)} />
  );
  if (autoAnalysis && snapshot.plan?.dryRun === true && AWAITING_PHASES.includes(snapshot.phase)) {
    return <AutoAnalysisBody snapshot={snapshot} nowMs={nowMs} />;
  }
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
          <PersistSection snapshot={snapshot} persist={persist} />
          <DoneBody
            snapshot={snapshot}
            pairChoices={pairChoices}
            geometryAccepts={geometryAccepts}
            mapBase={mapBase}
          />
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
