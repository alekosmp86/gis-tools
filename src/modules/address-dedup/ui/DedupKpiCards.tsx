"use client";

import React from "react";
import { formatNumber } from "@/core/common/ValueFormatter";
import { Decision, KpiTone } from "../constants";
import { decisionTotal, reviewCount } from "../domain/summaryView";
import type { DedupSummary } from "../types";
import { DedupKpiCard } from "./DedupKpiCard";
import styles from "./DedupKpiCards.module.css";

interface DedupKpiCardsProps {
  summary: DedupSummary;
}

export const DedupKpiCards: React.FC<DedupKpiCardsProps> = ({ summary }) => {
  const rowsToReview = reviewCount(summary);

  return (
    <div className={styles.grid}>
      <DedupKpiCard label="Grupos" value={formatNumber(summary.groupCount)} tone={KpiTone.NEUTRAL} />
      <DedupKpiCard label="Filas" value={formatNumber(summary.rowCount)} tone={KpiTone.NEUTRAL} />
      <DedupKpiCard
        label="A eliminar"
        value={formatNumber(decisionTotal(summary, Decision.REMOVE))}
        tone={KpiTone.REMOVE}
      />
      <DedupKpiCard
        label="A conservar"
        value={formatNumber(decisionTotal(summary, Decision.KEEP))}
        tone={KpiTone.KEEP}
      />
      <DedupKpiCard
        label="Para revisar"
        value={rowsToReview > 0 ? formatNumber(rowsToReview) : "Ninguna"}
        tone={KpiTone.REVIEW}
        hint="Conservadas junto a una fuente protegida"
        isDimmed={rowsToReview === 0}
      />
    </div>
  );
};
