"use client";

import React, { useRef } from "react";
import type { EjesSplitPointCandidate } from "../../../jobs/ejes-ide/types";
import { EjesSplitCandidateRow } from "./EjesSplitCandidateRow";
import { EJES_SPLIT_REVIEW_TEXT } from "./ejesSplitReviewTexts";
import styles from "./EjesSplitReview.module.css";

const ARROW_KEY_STEP: Partial<Record<string, number>> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};
const FIRST_INDEX = 0;

const wrappedIndexOf = (index: number, step: number, count: number): number => (index + step + count) % count;

export interface EjesSplitCandidateGroupProps {
  candidates: EjesSplitPointCandidate[];
  chosenRef: string | undefined;
  /** True when no piece can be chosen here: the choice is locked, or the request limit is reached. */
  disabled: boolean;
  onChoose: (newRef: string) => void;
}

/** The pieces of one point as a radio group: the arrow keys move and choose, and the text button clears the choice. */
export const EjesSplitCandidateGroup: React.FC<EjesSplitCandidateGroupProps> = ({ candidates, chosenRef, disabled, onChoose }) => {
  const rowElements = useRef<(HTMLButtonElement | null)[]>([]);
  const chosenIndex = candidates.findIndex((candidate) => candidate.newRef === chosenRef);
  const tabStopIndex = chosenIndex === -1 ? FIRST_INDEX : chosenIndex;

  const onRowKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = ARROW_KEY_STEP[event.key];
    if (step === undefined || disabled) return;
    event.preventDefault();
    const nextIndex = wrappedIndexOf(index, step, candidates.length);
    rowElements.current[nextIndex]?.focus();
    const next = candidates[nextIndex];
    if (next.newRef !== chosenRef) onChoose(next.newRef);
  };

  return (
    <div className={styles.group}>
      <div role="radiogroup" aria-label={EJES_SPLIT_REVIEW_TEXT.CHOICE_GROUP_LABEL} className={styles.candidates}>
        {candidates.map((candidate, index) => (
          <EjesSplitCandidateRow
            key={candidate.newRef}
            candidate={candidate}
            chosen={chosenRef === candidate.newRef}
            tabStop={index === tabStopIndex}
            disabled={disabled}
            rowRef={(element) => {
              rowElements.current[index] = element;
            }}
            onToggle={() => onChoose(candidate.newRef)}
            onKeyDown={(event) => onRowKeyDown(event, index)}
          />
        ))}
      </div>
      {chosenRef !== undefined && (
        <div className={styles.clearRow}>
          <button type="button" className={styles.clearButton} disabled={disabled} onClick={() => onChoose(chosenRef)}>
            {EJES_SPLIT_REVIEW_TEXT.UNCHOOSE}
          </button>
        </div>
      )}
    </div>
  );
};
