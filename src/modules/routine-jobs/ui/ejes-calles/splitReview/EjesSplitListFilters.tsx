"use client";

import React from "react";
import { EJES_SPLIT_REVIEW_TEXT } from "./ejesSplitReviewTexts";
import { ReasonFilterSelect } from "./ReasonFilterSelect";
import { AttentionFilterSelect } from "./AttentionFilterSelect";
import { EjesSplitAttentionCounts } from "./EjesSplitAttentionCounts";
import type { ReasonFilter } from "./ejesSplitReviewView";
import type { AttentionFilter, AttentionRank } from "../ejesCallesReportView";
import styles from "./EjesSplitReview.module.css";

export interface EjesSplitListFiltersProps {
  reason: ReasonFilter;
  onReason: (reason: ReasonFilter) => void;
  attention: AttentionFilter;
  onAttention: (attention: AttentionFilter) => void;
  attentionCounts: Record<AttentionRank, number>;
  street: string;
  onStreet: (street: string) => void;
}

/** The filters of the split list: by the reason of the review points, by attention rank (with the counts above them), and by the street (`idcalle`) as typed. */
export const EjesSplitListFilters: React.FC<EjesSplitListFiltersProps> = ({
  reason,
  onReason,
  attention,
  onAttention,
  attentionCounts,
  street,
  onStreet,
}) => (
  <div className={styles.filterBlock}>
    <EjesSplitAttentionCounts counts={attentionCounts} value={attention} onSelect={onAttention} />
    <div className={styles.filters}>
      <ReasonFilterSelect value={reason} onChange={onReason} />
      <AttentionFilterSelect value={attention} onChange={onAttention} />
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
  </div>
);
