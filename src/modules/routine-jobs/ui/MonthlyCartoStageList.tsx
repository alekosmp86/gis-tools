"use client";

import React from "react";
import { CircleAlert, CircleCheck, Circle } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import { MONTHLY_STAGES, type MonthlyStage, type MonthlyStageDef } from "./monthlyCartoStages";
import { StageStatus, statusOf, type StageOutcomes } from "./monthlyCartoState";
import styles from "./MonthlyCartoUpdate.module.css";

const OPEN_LABEL = "Abrir";
const SOON_LABEL = "Próximamente";
const STATUS_LABEL: Record<StageStatus, string> = {
  [StageStatus.PENDING]: "Pendiente",
  [StageStatus.DONE]: "Hecho en esta sesión",
  [StageStatus.FAILED]: "Error",
};

const STATUS_ICON = {
  [StageStatus.PENDING]: Circle,
  [StageStatus.DONE]: CircleCheck,
  [StageStatus.FAILED]: CircleAlert,
} as const;

const STATUS_CLASS: Record<StageStatus, string> = {
  [StageStatus.PENDING]: styles.statusPending,
  [StageStatus.DONE]: styles.statusDone,
  [StageStatus.FAILED]: styles.statusFailed,
};

export interface MonthlyCartoStageListProps {
  outcomes: StageOutcomes;
  onOpen: (stage: MonthlyStage) => void;
}

const StageRow: React.FC<{ def: MonthlyStageDef; index: number; status: StageStatus; onOpen: (stage: MonthlyStage) => void }> = ({
  def,
  index,
  status,
  onOpen,
}) => {
  const StatusIcon = STATUS_ICON[status];
  return (
    <li className={styles.stageRow}>
      <span className={styles.stageNumber}>{index + 1}</span>
      <div className={styles.stageText}>
        <h3 className={styles.stageTitle}>{def.title}</h3>
        <p className={styles.stageDescription}>{def.description}</p>
      </div>
      {def.available ? (
        <span className={`${styles.status} ${STATUS_CLASS[status]}`}>
          <StatusIcon size={15} />
          <span>{STATUS_LABEL[status]}</span>
        </span>
      ) : null}
      {def.available ? (
        <Button variant={ButtonVariant.SECONDARY} onClick={() => onOpen(def.id)}>
          <span>{OPEN_LABEL}</span>
        </Button>
      ) : (
        <Button variant={ButtonVariant.GHOST} isDisabled>
          <span>{SOON_LABEL}</span>
        </Button>
      )}
    </li>
  );
};

export const MonthlyCartoStageList: React.FC<MonthlyCartoStageListProps> = ({ outcomes, onOpen }) => (
  <ol className={styles.stageList}>
    {MONTHLY_STAGES.map((def, index) => (
      <StageRow key={def.id} def={def} index={index} status={statusOf(outcomes, def.id)} onOpen={onOpen} />
    ))}
  </ol>
);
