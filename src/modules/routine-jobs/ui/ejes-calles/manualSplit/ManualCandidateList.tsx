"use client";

import React from "react";
import type { EjesMapCandidate } from "../../../jobs/ejes-calles/types";
import { EJES_MANUAL_SPLIT_TEXT } from "../ejesAcceptTexts";
import { ManualCandidateRow } from "./ManualCandidateRow";
import styles from "./manualSplit.module.css";

export interface ManualCandidateListProps {
  /** The candidates, nearest first. */
  candidates: EjesMapCandidate[];
  chosenRefs: readonly string[];
  onToggle: (ref: string) => void;
}

/** The candidate sections as a checklist: each choice is also painted on the map. */
export function ManualCandidateList({ candidates, chosenRefs, onToggle }: ManualCandidateListProps) {
  if (candidates.length === 0) return <p className={styles.notice}>{EJES_MANUAL_SPLIT_TEXT.EMPTY}</p>;
  return (
    <ul className={styles.candidateList}>
      {candidates.map((candidate) => (
        <li key={candidate.ref}>
          <ManualCandidateRow candidate={candidate} chosen={chosenRefs.includes(candidate.ref)} onToggle={onToggle} />
        </li>
      ))}
    </ul>
  );
}
