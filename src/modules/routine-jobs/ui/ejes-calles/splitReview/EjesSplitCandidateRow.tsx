"use client";

import React from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { EjesSplitPointCandidate } from "../../../jobs/ejes-calles/types";
import { EJES_SPLIT_REVIEW_TEXT } from "./ejesSplitReviewTexts";
import styles from "./EjesSplitReview.module.css";

const ICON_SIZE = 15;

export interface EjesSplitCandidateRowProps {
  candidate: EjesSplitPointCandidate;
  chosen: boolean;
  disabled: boolean;
  onToggle: () => void;
}

const distanceTextOf = (distance: number | null): string =>
  distance === null ? EJES_SPLIT_REVIEW_TEXT.NO_DISTANCE : EJES_SPLIT_REVIEW_TEXT.DISTANCE_TEXT(distance);

/** One piece the point could go to: its distance, its marks, and the button that chooses it (choosing it again clears the choice). */
export const EjesSplitCandidateRow: React.FC<EjesSplitCandidateRowProps> = ({ candidate, chosen, disabled, onToggle }) => (
  <li className={chosen ? `${styles.candidate} ${styles.candidateChosen}` : styles.candidate}>
    <div className={styles.candidateText}>
      <span className={styles.candidateName}>{EJES_SPLIT_REVIEW_TEXT.PIECE_LABEL(candidate.newRef)}</span>
      <span className={styles.candidateDistance}>{distanceTextOf(candidate.distance)}</span>
    </div>
    <div className={styles.tags}>
      {candidate.isSuggestion && <span className={styles.tag}>{EJES_SPLIT_REVIEW_TEXT.SUGGESTED}</span>}
      {chosen && <span className={styles.tag}>{EJES_SPLIT_REVIEW_TEXT.CHOSEN}</span>}
    </div>
    <Button variant={chosen ? ButtonVariant.SECONDARY : ButtonVariant.PRIMARY} onClick={onToggle} disabled={disabled}>
      {chosen ? <X size={ICON_SIZE} /> : <Check size={ICON_SIZE} />}
      <span>{chosen ? EJES_SPLIT_REVIEW_TEXT.UNCHOOSE : EJES_SPLIT_REVIEW_TEXT.CHOOSE}</span>
    </Button>
  </li>
);
