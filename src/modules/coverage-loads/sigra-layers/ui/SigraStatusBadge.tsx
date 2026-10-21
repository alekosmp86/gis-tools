"use client";

import React from "react";
import { describeLayerStatus } from "../domain/statusLabels";
import { LayerLoadStatus } from "../types";
import styles from "./SigraResultTable.module.css";

interface SigraStatusBadgeProps {
  status: LayerLoadStatus;
}

const TONE_CLASSES: Readonly<Record<LayerLoadStatus, string>> = {
  [LayerLoadStatus.LOADED]: styles.ok,
  [LayerLoadStatus.DRY_RUN_OK]: styles.dryRun,
  [LayerLoadStatus.REJECTED_VALIDATION]: styles.failed,
  [LayerLoadStatus.FAILED]: styles.failed,
};

export const SigraStatusBadge: React.FC<SigraStatusBadgeProps> = ({ status }) => (
  <span className={`${styles.badge} ${TONE_CLASSES[status]}`}>{describeLayerStatus(status)}</span>
);
