"use client";

import React from "react";
import { KpiTone } from "../constants";
import styles from "./DedupKpiCard.module.css";

interface DedupKpiCardProps {
  label: string;
  value: string;
  tone: KpiTone;
  hint?: string;
  isDimmed?: boolean;
}

const TONE_CLASS: Readonly<Record<KpiTone, string>> = {
  [KpiTone.NEUTRAL]: styles.neutral,
  [KpiTone.REMOVE]: styles.remove,
  [KpiTone.KEEP]: styles.keep,
  [KpiTone.REVIEW]: styles.review,
};

export const DedupKpiCard: React.FC<DedupKpiCardProps> = ({
  label,
  value,
  tone,
  hint,
  isDimmed = false,
}) => (
  <div className={`glass-panel ${styles.card} ${TONE_CLASS[tone]} ${isDimmed ? styles.dimmed : ""}`}>
    <span className={styles.label}>{label}</span>
    <span className={styles.value}>{value}</span>
    {hint && <span className={styles.hint}>{hint}</span>}
  </div>
);
