"use client";

import React from "react";
import { formatNumber } from "@/core/common/ValueFormatter";
import { Decision, DecisionFilter, KpiTone } from "../constants";
import { EMPTY_CRITERIA } from "../domain/groupFilters";
import { decisionTotal, reviewCount } from "../domain/summaryView";
import type { DedupSummary, GroupFilterCriteria } from "../types";
import { DedupKpiCard } from "./DedupKpiCard";
import styles from "./DedupKpiCards.module.css";

interface DedupKpiCardsProps {
  summary: DedupSummary;
  onKpiSelect: (criteria: GroupFilterCriteria) => void;
}

const REMOVE_PRESET: GroupFilterCriteria = { ...EMPTY_CRITERIA, decision: DecisionFilter.REMOVE };
const KEEP_PRESET: GroupFilterCriteria = { ...EMPTY_CRITERIA, decision: DecisionFilter.KEEP };
const REVIEW_PRESET: GroupFilterCriteria = { ...EMPTY_CRITERIA, reviewOnly: true };

export const DedupKpiCards: React.FC<DedupKpiCardsProps> = ({ summary, onKpiSelect }) => {
  const rowsToReview = reviewCount(summary);

  return (
    <div className={styles.grid}>
      <DedupKpiCard
        label="Grupos"
        value={formatNumber(summary.groupCount)}
        tone={KpiTone.NEUTRAL}
        onClick={() => onKpiSelect(EMPTY_CRITERIA)}
      />
      <DedupKpiCard
        label="Filas"
        value={formatNumber(summary.rowCount)}
        tone={KpiTone.NEUTRAL}
        onClick={() => onKpiSelect(EMPTY_CRITERIA)}
      />
      <DedupKpiCard
        label="A eliminar"
        value={formatNumber(decisionTotal(summary, Decision.REMOVE))}
        tone={KpiTone.REMOVE}
        onClick={() => onKpiSelect(REMOVE_PRESET)}
      />
      <DedupKpiCard
        label="A conservar"
        value={formatNumber(decisionTotal(summary, Decision.KEEP))}
        tone={KpiTone.KEEP}
        onClick={() => onKpiSelect(KEEP_PRESET)}
      />
      <DedupKpiCard
        label="Para revisar"
        value={rowsToReview > 0 ? formatNumber(rowsToReview) : "Ninguna"}
        tone={KpiTone.REVIEW}
        hint="Requieren revisión manual antes de eliminar"
        isDimmed={rowsToReview === 0}
        onClick={() => onKpiSelect(REVIEW_PRESET)}
      />
    </div>
  );
};
