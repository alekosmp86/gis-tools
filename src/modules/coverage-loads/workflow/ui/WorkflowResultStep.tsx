"use client";

import React from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { ConnectionPayload } from "../../types";
import type { StageProgress } from "../domain/workflowState";
import type { CoverageStage } from "./coverageStages";
import { StageStatusChip } from "./StageStatusChip";
import { WorkflowStepCard } from "./WorkflowStepCard";
import styles from "./WorkflowResultStep.module.css";

interface WorkflowResultStepProps {
  stages: ReadonlyArray<CoverageStage>;
  progress: Readonly<Record<string, StageProgress>>;
  connection: ConnectionPayload;
  onBack: () => void;
}

interface StageSummaryProps {
  stage: CoverageStage;
  progress: StageProgress;
  connection: ConnectionPayload;
}

const StageSummary: React.FC<StageSummaryProps> = ({ stage, progress, connection }) => {
  const { ResultExtras } = stage;

  return (
    <li className={styles.summary}>
      <div className={styles.summaryHeader}>
        <h3 className={styles.stageTitle}>{stage.label}</h3>
        <StageStatusChip status={progress.status} />
      </div>
      {progress.outcome && (
        <div>
          <p className={styles.headline}>{progress.outcome.headline}</p>
          <ul className={styles.lines}>
            {progress.outcome.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {ResultExtras && <ResultExtras connection={connection} />}
    </li>
  );
};

/** Every stage with its status and outcome, plus the extras each stage offers (such as reports). */
export const WorkflowResultStep: React.FC<WorkflowResultStepProps> = ({ stages, progress, connection, onBack }) => (
  <WorkflowStepCard title="Resultado">
    <ul className={styles.list}>
      {stages.map((stage) => (
        <StageSummary key={stage.id} stage={stage} progress={progress[stage.id]} connection={connection} />
      ))}
    </ul>
    <div className={styles.actions}>
      <Button type="button" variant={ButtonVariant.SECONDARY} onClick={onBack}>
        <ArrowLeft size={15} />
        Volver a los pasos
      </Button>
    </div>
  </WorkflowStepCard>
);
