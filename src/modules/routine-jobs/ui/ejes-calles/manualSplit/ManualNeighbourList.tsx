"use client";

import React from "react";
import type { EjesMapNeighbour } from "../../../jobs/ejes-calles/types";
import { metersTextOf } from "../ejesCallesReportView";
import { EJES_MANUAL_SPLIT_TEXT } from "../ejesAcceptTexts";
import styles from "./manualSplit.module.css";

export interface ManualNeighbourListProps {
  /** The neighbour old sections, nearest first; the block is hidden when there are none. */
  neighbours: EjesMapNeighbour[];
  /** The ticked neighbours: each one merges into the one new section chosen for this row. */
  mergeRefs: readonly string[];
  onToggle: (ref: string) => void;
}

interface ManualNeighbourRowProps {
  neighbour: EjesMapNeighbour;
  merged: boolean;
  onToggle: (ref: string) => void;
}

const chipsOf = (neighbour: EjesMapNeighbour): string[] => [
  EJES_MANUAL_SPLIT_TEXT.CHIP_LENGTH(metersTextOf(neighbour.length)),
  EJES_MANUAL_SPLIT_TEXT.CHIP_POINTS(neighbour.points),
  EJES_MANUAL_SPLIT_TEXT.CHIP_DISTANCE(metersTextOf(neighbour.distance)),
];

function ManualNeighbourRow({ neighbour, merged, onToggle }: ManualNeighbourRowProps) {
  const rowClass = merged ? `${styles.candidateRow} ${styles.candidateRowChosen}` : styles.candidateRow;
  return (
    <label className={rowClass}>
      <input
        type="checkbox"
        className={styles.check}
        checked={merged}
        onChange={() => onToggle(neighbour.ref)}
        aria-label={EJES_MANUAL_SPLIT_TEXT.CHOOSE_NEIGHBOUR_ARIA(neighbour.ref)}
      />
      <span className={styles.candidateMain}>
        <span className={styles.candidateHead}>
          <strong className={styles.candidateRef}>{neighbour.ref}</strong>
        </span>
        <span className={styles.candidateMeta}>
          {chipsOf(neighbour).map((chipText) => (
            <span key={chipText} className={styles.candidateChip}>
              {chipText}
            </span>
          ))}
        </span>
      </span>
    </label>
  );
}

/** The old sections near this one that may merge with it into one new section: a checklist, hidden when there are none. */
export function ManualNeighbourList({ neighbours, mergeRefs, onToggle }: ManualNeighbourListProps) {
  if (neighbours.length === 0) return null;
  return (
    <section className={styles.neighbourBlock}>
      <h3 className={styles.neighbourTitle}>{EJES_MANUAL_SPLIT_TEXT.NEIGHBOURS_TITLE}</h3>
      <p className={styles.hint}>{EJES_MANUAL_SPLIT_TEXT.NEIGHBOURS_HINT}</p>
      <ul className={styles.neighbourList}>
        {neighbours.map((neighbour) => (
          <li key={neighbour.ref}>
            <ManualNeighbourRow neighbour={neighbour} merged={mergeRefs.includes(neighbour.ref)} onToggle={onToggle} />
          </li>
        ))}
      </ul>
    </section>
  );
}
