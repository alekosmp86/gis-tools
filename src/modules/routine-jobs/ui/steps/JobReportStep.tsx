"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import { RunPhase } from "../jobRunStore";
import { RunResultActions } from "./RunResultParts";
import styles from "./WizardSteps.module.css";

export interface JobReportTexts {
  idleHint: string;
  runningHint: string;
  noReport: string;
  notFinished: string;
}

export interface JobReportStepProps<Result> {
  snapshot: { phase: RunPhase; job?: { result?: Result } };
  texts: JobReportTexts;
  renderReport: (result: Result) => React.ReactNode;
  onNewRun: () => void;
  onBackToReview: () => void;
}

export function JobReportStep<Result>({
  snapshot,
  texts,
  renderReport,
  onNewRun,
  onBackToReview,
}: JobReportStepProps<Result>) {
  const actions = <RunResultActions onNewRun={onNewRun} onBackToReview={onBackToReview} />;
  switch (snapshot.phase) {
    case RunPhase.IDLE:
      return <p className={styles.hint}>{texts.idleHint}</p>;
    case RunPhase.STARTING:
    case RunPhase.RUNNING:
      return <p className={styles.hint}>{texts.runningHint}</p>;
    case RunPhase.DONE: {
      const result = snapshot.job?.result;
      return (
        <div className={styles.stack}>
          {result ? renderReport(result) : <AlertMessage type={AlertType.WARNING} text={texts.noReport} />}
          {actions}
        </div>
      );
    }
    case RunPhase.FAILED:
    case RunPhase.UNKNOWN:
      return (
        <div className={styles.stack}>
          <AlertMessage type={AlertType.WARNING} text={texts.notFinished} />
          {actions}
        </div>
      );
  }
}
