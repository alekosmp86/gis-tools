"use client";

import React from "react";
import type { EjesSplitPointCandidate } from "../../../jobs/ejes-calles/types";
import { EJES_SPLIT_REVIEW_TEXT } from "./ejesSplitReviewTexts";
import styles from "./EjesSplitReview.module.css";

export interface EjesSplitCandidateRowProps {
  candidate: EjesSplitPointCandidate;
  chosen: boolean;
  /** Only one row of the group takes the Tab stop; the arrow keys move between the others. */
  tabStop: boolean;
  disabled: boolean;
  rowRef: React.Ref<HTMLButtonElement>;
  onToggle: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

const distanceTextOf = (distance: number | null): string =>
  distance === null ? EJES_SPLIT_REVIEW_TEXT.NO_DISTANCE : EJES_SPLIT_REVIEW_TEXT.METERS(String(distance));

const distanceTitleOf = (distance: number | null): string | undefined =>
  distance === null ? undefined : EJES_SPLIT_REVIEW_TEXT.DISTANCE_TEXT(distance);

const classesOf = (...classes: (string | false)[]): string => classes.filter(Boolean).join(" ");

/** One piece the point could go to, as a radio of its group: choosing it again clears the choice. */
export const EjesSplitCandidateRow: React.FC<EjesSplitCandidateRowProps> = ({
  candidate,
  chosen,
  tabStop,
  disabled,
  rowRef,
  onToggle,
  onKeyDown,
}) => (
  <button
    ref={rowRef}
    type="button"
    role="radio"
    aria-checked={chosen}
    tabIndex={tabStop ? 0 : -1}
    title={distanceTitleOf(candidate.distance)}
    disabled={disabled}
    className={classesOf(styles.candidate, chosen && styles.candidateChosen)}
    onClick={onToggle}
    onKeyDown={onKeyDown}
  >
    <span className={classesOf(styles.radioMark, chosen && styles.radioMarkChosen)} aria-hidden="true" />
    <span className={styles.candidateName}>{EJES_SPLIT_REVIEW_TEXT.PIECE_LABEL(candidate.newRef)}</span>
    <span className={styles.candidateDistance}>{distanceTextOf(candidate.distance)}</span>
    {candidate.isSuggestion && <span className={styles.tag}>{EJES_SPLIT_REVIEW_TEXT.SUGGESTED}</span>}
  </button>
);
