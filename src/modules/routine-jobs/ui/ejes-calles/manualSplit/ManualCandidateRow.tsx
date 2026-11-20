"use client";

import React from "react";
import type { EjesMapCandidate } from "../../../jobs/ejes-calles/types";
import { metersTextOf } from "../ejesCallesReportView";
import { EJES_MANUAL_SPLIT_TEXT } from "../ejesAcceptTexts";
import styles from "./manualSplit.module.css";

export interface ManualCandidateRowProps {
  candidate: EjesMapCandidate;
  chosen: boolean;
  onToggle: (ref: string) => void;
}

const chipsOf = (candidate: EjesMapCandidate): string[] => [
  EJES_MANUAL_SPLIT_TEXT.CHIP_LENGTH(metersTextOf(candidate.length)),
  EJES_MANUAL_SPLIT_TEXT.CHIP_NEAR(metersTextOf(candidate.nearLength)),
  EJES_MANUAL_SPLIT_TEXT.CHIP_COVERED(candidate.coveredPercent),
  EJES_MANUAL_SPLIT_TEXT.CHIP_DISTANCE(metersTextOf(candidate.distance)),
];

export function ManualCandidateRow({ candidate, chosen, onToggle }: ManualCandidateRowProps) {
  const rowClass = chosen ? `${styles.candidateRow} ${styles.candidateRowChosen}` : styles.candidateRow;
  return (
    <label className={rowClass}>
      <input
        type="checkbox"
        className={styles.check}
        checked={chosen}
        onChange={() => onToggle(candidate.ref)}
        aria-label={EJES_MANUAL_SPLIT_TEXT.CHOOSE_ARIA(candidate.ref)}
      />
      <span className={styles.candidateMain}>
        <span className={styles.candidateHead}>
          <strong className={styles.candidateRef}>{candidate.ref}</strong>
          {candidate.name && (
            <span className={styles.candidateName} title={candidate.name}>
              {candidate.name}
            </span>
          )}
        </span>
        <span className={styles.candidateMeta}>
          {candidate.localities && <span>{candidate.localities}</span>}
          {chipsOf(candidate).map((chipText) => (
            <span key={chipText} className={styles.candidateChip}>
              {chipText}
            </span>
          ))}
        </span>
      </span>
    </label>
  );
}
