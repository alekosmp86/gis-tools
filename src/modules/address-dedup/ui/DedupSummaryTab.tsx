"use client";

import React from "react";
import type { DedupSummary, GroupFilterCriteria } from "../types";
import { DedupDecisionMatrix } from "./DedupDecisionMatrix";
import { DedupKpiCards } from "./DedupKpiCards";
import { DedupReasonTable } from "./DedupReasonTable";
import styles from "./DedupSummaryTab.module.css";

interface DedupSummaryTabProps {
  summary: DedupSummary;
  onKpiSelect: (criteria: GroupFilterCriteria) => void;
}

export const DedupSummaryTab: React.FC<DedupSummaryTabProps> = ({ summary, onKpiSelect }) => (
  <div className={styles.stack}>
    <DedupKpiCards summary={summary} onKpiSelect={onKpiSelect} />
    <DedupDecisionMatrix summary={summary} />
    <DedupReasonTable summary={summary} />
  </div>
);
