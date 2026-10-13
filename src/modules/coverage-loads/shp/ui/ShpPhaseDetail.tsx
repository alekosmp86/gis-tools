"use client";

import React from "react";
import type { JobStatus } from "../job/types.ts";
import { phaseDetail, stagePercent } from "../domain/shpJobView";
import styles from "./ShpPhaseDetail.module.css";

interface ShpPhaseDetailProps {
  status: JobStatus;
}

/** Progress of the running phase on its own, with the count it reports (bytes read, pieces repaired). */
export const ShpPhaseDetail: React.FC<ShpPhaseDetailProps> = ({ status }) => {
  if (status.stage === null) return null;
  const detail = phaseDetail(status);

  return (
    <p className={styles.detail}>
      Fase actual: {stagePercent(status)}%{detail === null ? "" : `, ${detail}`}
    </p>
  );
};
