"use client";

import React from "react";
import type { DedupSummary } from "../types";
import { DedupDecisionMatrix } from "./DedupDecisionMatrix";
import { DedupKpiCards } from "./DedupKpiCards";
import { DedupReasonTable } from "./DedupReasonTable";
import styles from "./DedupSummaryTab.module.css";

interface DedupSummaryTabProps {
  summary: DedupSummary;
}

export const DedupSummaryTab: React.FC<DedupSummaryTabProps> = ({ summary }) => (
  <div className={styles.stack}>
    <DedupKpiCards summary={summary} />
    <DedupDecisionMatrix summary={summary} />
    <DedupReasonTable summary={summary} />
  </div>
);
