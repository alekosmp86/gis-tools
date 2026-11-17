"use client";

import React from "react";
import { EJES_SPLIT_REASON_FILTER_TEXT, EJES_SPLIT_REVIEW_TEXT } from "./ejesSplitReviewTexts";
import { REASON_FILTER, type ReasonFilter } from "./ejesSplitReviewView";
import styles from "./EjesSplitReview.module.css";

export interface ReasonFilterSelectProps {
  value: ReasonFilter;
  onChange: (value: ReasonFilter) => void;
}

const REASON_OPTIONS: readonly { value: ReasonFilter; label: string }[] = [
  { value: REASON_FILTER.ALL, label: EJES_SPLIT_REASON_FILTER_TEXT.ALL },
  { value: REASON_FILTER.AMBIGUOUS, label: EJES_SPLIT_REASON_FILTER_TEXT.AMBIGUOUS },
  { value: REASON_FILTER.NO_GEOMETRY, label: EJES_SPLIT_REASON_FILTER_TEXT.NO_GEOMETRY },
];

/** The reason filter of the split list and of the point review. */
export const ReasonFilterSelect: React.FC<ReasonFilterSelectProps> = ({ value, onChange }) => (
  <label className={styles.field}>
    <span className={styles.fieldLabel}>{EJES_SPLIT_REVIEW_TEXT.FILTER_REASON}</span>
    <select className={styles.fieldControl} value={value} onChange={(event) => onChange(event.currentTarget.value as ReasonFilter)}>
      {REASON_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </label>
);
