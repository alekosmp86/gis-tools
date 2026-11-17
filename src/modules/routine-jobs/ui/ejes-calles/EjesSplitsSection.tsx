"use client";

import React, { useState } from "react";
import type { EjesSplitRow } from "../../jobs/ejes-calles/types";
import type { EjesSplitPointsBase } from "../shared/clientTypes";
import type { TableColumn } from "../shared/ReportParts";
import { EjesAcceptableRows } from "./EjesAcceptableRows";
import { EjesAcceptList, chosenCountsOf, isSplitAcceptable, splitKeyOf, toggleSplitAcceptance, type EjesAcceptView } from "./ejesAccept";
import { EJES_ACCEPT_TEXT } from "./ejesAcceptTexts";
import { SKIP_REASON_TEXT } from "./ejesLoadTexts";
import acceptStyles from "./EjesAccept.module.css";
import { EjesSplitListFilters } from "./splitReview/EjesSplitListFilters";
import { EjesSplitReviewCell } from "./splitReview/EjesSplitReviewCell";
import { EjesSplitReviewModal } from "./splitReview/EjesSplitReviewModal";
import { EJES_SPLIT_REVIEW_TEXT } from "./splitReview/ejesSplitReviewTexts";
import { REASON_FILTER, type ReasonFilter } from "./splitReview/ejesSplitReviewView";

const reasonMatches = (row: EjesSplitRow, reason: ReasonFilter): boolean => {
  if (reason === REASON_FILTER.AMBIGUOUS) return row.reviewPoints > 0;
  if (reason === REASON_FILTER.NO_GEOMETRY) return row.noGeometryPoints > 0;
  return true;
};

const streetMatches = (row: EjesSplitRow, street: string): boolean => {
  const term = street.trim().toLowerCase();
  return term === "" || (row.idcalle ?? "").toLowerCase().includes(term);
};

/** Why a split row has no accept button: the load holds it, its review is incomplete, or its points are not decided yet. */
const blockedTextOf = (row: EjesSplitRow): string => {
  if (row.heldReason !== null) return SKIP_REASON_TEXT[row.heldReason];
  if (row.incompleteReview) return EJES_SPLIT_REVIEW_TEXT.INCOMPLETE_REVIEW;
  return EJES_ACCEPT_TEXT.NEEDS_REVIEW;
};

export interface EjesSplitsSectionProps {
  /** The split rows of the analysis, as listed. */
  rows: EjesSplitRow[];
  /** Every split the analysis counted. */
  total: number;
  columns: TableColumn<EjesSplitRow>[];
  accept: EjesAcceptView;
  /** The connection, tables and dry run of the wizard for the review; null while the wizard holds no password. */
  splitBase: EjesSplitPointsBase | null;
  onShowOnMap: (row: EjesSplitRow) => void;
}

/** The splits list with its filters, the review column of each split (EJS-6) and the accept controls of EJ-24. */
export const EjesSplitsSection: React.FC<EjesSplitsSectionProps> = ({ rows, total, columns, accept, splitBase, onShowOnMap }) => {
  const [reason, setReason] = useState<ReasonFilter>(REASON_FILTER.ALL);
  const [street, setStreet] = useState<string>("");
  const [openSplit, setOpenSplit] = useState<EjesSplitRow | null>(null);
  const [capNote, setCapNote] = useState<string | null>(null);
  const chosen = chosenCountsOf(accept.pointChoices);
  const filtering = reason !== REASON_FILTER.ALL || street.trim() !== "";
  const listed = rows.filter((row) => reasonMatches(row, reason) && streetMatches(row, street));
  const withReview: TableColumn<EjesSplitRow>[] = [
    ...columns,
    {
      header: EJES_SPLIT_REVIEW_TEXT.COLUMN,
      cell: (row) => <EjesSplitReviewCell row={row} chosen={chosen.get(row.oldRef) ?? 0} onOpen={() => setOpenSplit(row)} />,
    },
  ];
  return (
    <>
      <EjesSplitListFilters reason={reason} onReason={setReason} street={street} onStreet={setStreet} />
      {filtering && <p className={acceptStyles.note}>{EJES_SPLIT_REVIEW_TEXT.FILTERED_LIST(listed.length, rows.length)}</p>}
      <p className={acceptStyles.note}>{EJES_ACCEPT_TEXT.SPLIT_NOTE}</p>
      {capNote !== null && <p className={acceptStyles.note}>{capNote}</p>}
      <EjesAcceptableRows
        list={EjesAcceptList.SPLITS}
        rows={listed}
        total={filtering ? listed.length : total}
        columns={withReview}
        rowKey={splitKeyOf}
        onShowOnMap={onShowOnMap}
        acceptable={(row) => isSplitAcceptable(row, chosen.get(row.oldRef) ?? 0)}
        notAcceptableTextOf={blockedTextOf}
        onToggleRow={(row, isAccepted) => setCapNote(toggleSplitAcceptance(accept, row.oldRef, isAccepted))}
        accept={accept}
      />
      {openSplit !== null && (
        <EjesSplitReviewModal split={openSplit} base={splitBase} accept={accept} onClose={() => setOpenSplit(null)} />
      )}
    </>
  );
};
