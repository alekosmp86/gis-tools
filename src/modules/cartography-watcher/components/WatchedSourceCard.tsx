"use client";

import React from "react";
import type { WatchedSourceConfig, SourceCheckSummary } from "../types/watcher";
import { SourceStatusBadge } from "./SourceStatusBadge";
import styles from "./SourceSelector.module.css";

export interface WatchedSourceCardProps {
  source: WatchedSourceConfig;
  isSelected: boolean;
  summary?: SourceCheckSummary;
  isCheckingSummaries: boolean;
  onSelect: (sourceId: string) => void;
}

export const WatchedSourceCard: React.FC<WatchedSourceCardProps> = ({
  source,
  isSelected,
  summary,
  isCheckingSummaries,
  onSelect,
}) => {
  return (
    <button
      type="button"
      className={`${styles.sourceCard} ${
        isSelected ? styles.sourceCardActive : ""
      }`}
      onClick={() => onSelect(source.id)}
      aria-pressed={isSelected}
    >
      <div className={styles.sourceTop}>
        {source.category && (
          <span className={styles.categoryTag}>{source.category}</span>
        )}
        <SourceStatusBadge
          summary={summary}
          isChecking={isCheckingSummaries}
        />
      </div>

      <h4 className={styles.sourceTitle}>{source.title}</h4>
      {source.description && (
        <p className={styles.sourceDesc}>{source.description}</p>
      )}
    </button>
  );
};

WatchedSourceCard.displayName = "WatchedSourceCard";
