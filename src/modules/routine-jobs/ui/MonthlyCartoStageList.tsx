"use client";

import React from "react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import { MONTHLY_STAGES, type MonthlyStage, type MonthlyStageDef } from "./monthlyCartoStages";
import styles from "./MonthlyCartoUpdate.module.css";

const OPEN_LABEL = "Abrir";

export interface MonthlyCartoStageListProps {
  onOpen: (stage: MonthlyStage) => void;
}

const StageRow: React.FC<{ def: MonthlyStageDef; index: number; onOpen: (stage: MonthlyStage) => void }> = ({
  def,
  index,
  onOpen,
}) => (
  <li className={styles.stageRow}>
    <span className={styles.stageNumber}>{index + 1}</span>
    <div className={styles.stageText}>
      <h3 className={styles.stageTitle}>{def.title}</h3>
      <p className={styles.stageDescription}>{def.description}</p>
    </div>
    <Button variant={ButtonVariant.SECONDARY} onClick={() => onOpen(def.id)}>
      <span>{OPEN_LABEL}</span>
    </Button>
  </li>
);

export const MonthlyCartoStageList: React.FC<MonthlyCartoStageListProps> = ({ onOpen }) => (
  <ol className={styles.stageList}>
    {MONTHLY_STAGES.map((def, index) => (
      <StageRow key={def.id} def={def} index={index} onOpen={onOpen} />
    ))}
  </ol>
);
