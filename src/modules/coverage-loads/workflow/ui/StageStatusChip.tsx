"use client";

import React from "react";
import { StageStatus } from "../../shared/domain/stageContract";
import { STAGE_STATUS_LABELS } from "./stageStatusLabels";
import styles from "./StageStatusChip.module.css";

interface StageStatusChipProps {
  status: StageStatus;
}

const TONE_CLASS: Readonly<Record<StageStatus, string>> = {
  [StageStatus.PENDING]: styles.pending,
  [StageStatus.SKIPPED]: styles.skipped,
  [StageStatus.BUSY]: styles.busy,
  [StageStatus.DONE]: styles.done,
  [StageStatus.FAILED]: styles.failed,
};

export const StageStatusChip: React.FC<StageStatusChipProps> = ({ status }) => (
  <span className={`${styles.chip} ${TONE_CLASS[status]}`}>{STAGE_STATUS_LABELS[status]}</span>
);
