"use client";

import React from "react";
import { EJES_SPLIT_REVIEW_TEXT } from "./ejesSplitReviewTexts";
import { ReasonFilterSelect } from "./ReasonFilterSelect";
import type { ReasonFilter } from "./ejesSplitReviewView";
import styles from "./EjesSplitReview.module.css";

export interface EjesSplitListFiltersProps {
  reason: ReasonFilter;
  onReason: (reason: ReasonFilter) => void;
  street: string;
  onStreet: (street: string) => void;
}

/** The filters of the split list: by the reason of the review points, and by the street (`idcalle`) as typed. */
export const EjesSplitListFilters: React.FC<EjesSplitListFiltersProps> = ({ reason, onReason, street, onStreet }) => (
  <div className={styles.filters}>
    <ReasonFilterSelect value={reason} onChange={onReason} />
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{EJES_SPLIT_REVIEW_TEXT.FILTER_STREET}</span>
      <input
        className={styles.fieldControl}
        type="text"
        value={street}
        placeholder={EJES_SPLIT_REVIEW_TEXT.FILTER_STREET_PLACEHOLDER}
        onChange={(event) => onStreet(event.currentTarget.value)}
      />
    </label>
  </div>
);
