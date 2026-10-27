"use client";

import React from "react";
import { ChartColumn } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType } from "@/ui-kit/types/ui";
import { RunPhase } from "../jobRunStore";
import type { RunPlan } from "../stepChecklist";
import { RunProgressStatus, RunResultActions } from "./RunResultParts";
import { RunStepChecklist } from "./RunStepChecklist";
import styles from "./WizardSteps.module.css";

export interface JobRunTexts {
  idleHint: string;
  dryRunDone: string;
  realRunDone: string;
  failedFallback: string;
  unknownTitle: string;
  unknownAdvice: string;
}

export interface JobRunSnapshotShape {
  phase: RunPhase;
  jobId?: string;
  job?: { startedAt: number; steps?: string[]; step?: string | null };
  error?: string;
  startedAt?: number;
  plan?: RunPlan;
}

export interface JobRunStepProps {
  snapshot: JobRunSnapshotShape;
  texts: JobRunTexts;
  nowMs: number;
  onNewRun: () => void;
  onBackToReview: () => void;
  onOpenReport: () => void;
}

const SEE_REPORT_LABEL = "Ver informe";

const textOr = (value: string | undefined, fallback: string): string =>
  value !== undefined && value.trim() !== "" ? value : fallback;

function OutcomeChecklist({ snapshot }: { snapshot: JobRunSnapshotShape }) {
  return (
    <RunStepChecklist
      plan={snapshot.plan}
      steps={snapshot.job?.steps}
      currentLabel={snapshot.job?.step || null}
      phase={snapshot.phase}
    />
  );
}

function DoneBody({
  snapshot,
  texts,
  onOpenReport,
}: {
  snapshot: JobRunSnapshotShape;
  texts: JobRunTexts;
  onOpenReport: () => void;
}) {
  const isDryRun = snapshot.plan?.dryRun ?? false;
  return (
    <>
      <AlertMessage type={AlertType.SUCCESS} text={isDryRun ? texts.dryRunDone : texts.realRunDone} />
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

function UnknownBody({ snapshot, texts }: { snapshot: JobRunSnapshotShape; texts: JobRunTexts }) {
  return (
    <>
      <AlertMessage type={AlertType.ERROR} text={texts.unknownTitle} />
      <p className={styles.hint}>{`Identificador del trabajo: ${snapshot.jobId ?? "no disponible"}. ${texts.unknownAdvice}`}</p>
      <OutcomeChecklist snapshot={snapshot} />
    </>
  );
}

function FailedBody({ snapshot, texts }: { snapshot: JobRunSnapshotShape; texts: JobRunTexts }) {
  return (
    <>
      <AlertMessage type={AlertType.ERROR} text={textOr(snapshot.error, texts.failedFallback)} />
      <OutcomeChecklist snapshot={snapshot} />
    </>
  );
}

export const JobRunStep: React.FC<JobRunStepProps> = ({ snapshot, texts, nowMs, onNewRun, onBackToReview, onOpenReport }) => {
  const actions = <RunResultActions onNewRun={onNewRun} onBackToReview={onBackToReview} />;
  switch (snapshot.phase) {
    case RunPhase.IDLE:
      return <p className={styles.hint}>{texts.idleHint}</p>;
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
          <DoneBody snapshot={snapshot} texts={texts} onOpenReport={onOpenReport} />
          {actions}
        </div>
      );
    case RunPhase.FAILED:
      return (
        <div className={styles.stack}>
          <FailedBody snapshot={snapshot} texts={texts} />
          {actions}
        </div>
      );
    case RunPhase.UNKNOWN:
      return (
        <div className={styles.stack}>
          <UnknownBody snapshot={snapshot} texts={texts} />
          {actions}
        </div>
      );
  }
};
