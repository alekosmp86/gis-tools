"use client";

import React from "react";
import type { DedupRequestPayload, DedupSummary, GroupFilterCriteria } from "../types";
import { DedupDecisionMatrix } from "./DedupDecisionMatrix";
import { DedupKpiCards } from "./DedupKpiCards";
import { DedupReasonTable } from "./DedupReasonTable";
import { DedupRemovalPanel } from "./DedupRemovalPanel";
import styles from "./DedupSummaryTab.module.css";

interface DedupSummaryTabProps {
  summary: DedupSummary;
  payload: DedupRequestPayload;
  onKpiSelect: (criteria: GroupFilterCriteria) => void;
}

export const DedupSummaryTab: React.FC<DedupSummaryTabProps> = ({ summary, payload, onKpiSelect }) => (
  <div className={styles.stack}>
    <DedupKpiCards summary={summary} onKpiSelect={onKpiSelect} />
    <DedupRemovalPanel summary={summary} payload={payload} />
    <DedupDecisionMatrix summary={summary} />
    <DedupReasonTable summary={summary} />
  </div>
);
