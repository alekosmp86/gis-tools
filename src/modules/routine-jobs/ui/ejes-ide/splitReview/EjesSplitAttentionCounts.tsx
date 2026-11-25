"use client";

import React from "react";
import { EJES_SPLIT_ATTENTION_COUNT_TEXT } from "./ejesSplitReviewTexts";
import { ATTENTION_RANK, FILTER_OF_RANK, type AttentionFilter, type AttentionRank } from "../ejesIdeReportView";
import styles from "./EjesSplitReview.module.css";

export interface EjesSplitAttentionCountsProps {
  counts: Record<AttentionRank, number>;
  value: AttentionFilter;
  onSelect: (filter: AttentionFilter) => void;
}

const COUNT_ITEMS: readonly { rank: AttentionRank; label: string }[] = [
  { rank: ATTENTION_RANK.DECISION, label: EJES_SPLIT_ATTENTION_COUNT_TEXT.DECISION },
  { rank: ATTENTION_RANK.READY, label: EJES_SPLIT_ATTENTION_COUNT_TEXT.READY },
  { rank: ATTENTION_RANK.HELD, label: EJES_SPLIT_ATTENTION_COUNT_TEXT.HELD },
];

/** The splits per attention rank, small above the list; each count filters the list to its rank. The first one is emphasised. */
export const EjesSplitAttentionCounts: React.FC<EjesSplitAttentionCountsProps> = ({ counts, value, onSelect }) => (
  <p className={styles.attentionCounts}>
    {COUNT_ITEMS.map((item, index) => {
      const filter = FILTER_OF_RANK[item.rank];
      return (
        <React.Fragment key={item.rank}>
          {index > 0 && <span aria-hidden="true">{EJES_SPLIT_ATTENTION_COUNT_TEXT.SEPARATOR}</span>}
          <button
            type="button"
            className={value === filter ? styles.attentionCountActive : styles.attentionCount}
            aria-pressed={value === filter}
            onClick={() => onSelect(filter)}
          >
            <span className={index === 0 ? styles.attentionEmphasis : undefined}>{counts[item.rank]}</span> {item.label}
          </button>
        </React.Fragment>
      );
    })}
  </p>
);
