"use client";

import React from "react";
import type { EjesMapCandidate } from "../../../jobs/ejes-calles/types";
import { RowsTable, type TableColumn } from "../../shared/ReportParts";
import { metersTextOf } from "../ejesCallesReportView";
import { EJES_MANUAL_SPLIT_TEXT } from "../ejesAcceptTexts";
import { textOrNoData } from "../../shared/reportFormat";
import styles from "./manualSplit.module.css";

export interface ManualCandidateListProps {
  /** The candidates, nearest first. */
  candidates: EjesMapCandidate[];
  chosenRefs: readonly string[];
  onToggle: (ref: string) => void;
}

const columnsOf = (chosenRefs: readonly string[], onToggle: (ref: string) => void): TableColumn<EjesMapCandidate>[] => [
  {
    header: EJES_MANUAL_SPLIT_TEXT.COLUMN_CHOOSE,
    cell: (candidate) => (
      <input
        type="checkbox"
        className={styles.check}
        checked={chosenRefs.includes(candidate.ref)}
        onChange={() => onToggle(candidate.ref)}
        aria-label={EJES_MANUAL_SPLIT_TEXT.CHOOSE_ARIA(candidate.ref)}
      />
    ),
  },
  { header: EJES_MANUAL_SPLIT_TEXT.COLUMN_REF, cell: (candidate) => candidate.ref },
  { header: EJES_MANUAL_SPLIT_TEXT.COLUMN_STREET, cell: (candidate) => textOrNoData(candidate.name) },
  { header: EJES_MANUAL_SPLIT_TEXT.COLUMN_LOCALITY, cell: (candidate) => textOrNoData(candidate.localities) },
  { header: EJES_MANUAL_SPLIT_TEXT.COLUMN_LENGTH, cell: (candidate) => metersTextOf(candidate.length) },
  { header: EJES_MANUAL_SPLIT_TEXT.COLUMN_NEAR, cell: (candidate) => metersTextOf(candidate.nearLength) },
  { header: EJES_MANUAL_SPLIT_TEXT.COLUMN_COVERED, cell: (candidate) => `${candidate.coveredPercent}%` },
  { header: EJES_MANUAL_SPLIT_TEXT.COLUMN_DISTANCE, cell: (candidate) => metersTextOf(candidate.distance) },
];

/** The candidate sections as a checklist: each choice is also painted on the map. */
export function ManualCandidateList({ candidates, chosenRefs, onToggle }: ManualCandidateListProps) {
  if (candidates.length === 0) return <p className={styles.notice}>{EJES_MANUAL_SPLIT_TEXT.EMPTY}</p>;
  return <RowsTable columns={columnsOf(chosenRefs, onToggle)} rows={candidates} rowKey={(candidate) => candidate.ref} />;
}
