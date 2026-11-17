"use client";

import React, { useMemo, useState } from "react";
import type { EjesSplitRow } from "../../jobs/ejes-calles/types";
import type { EjesSplitPointsBase } from "../shared/clientTypes";
import { EjesAcceptableRows } from "./EjesAcceptableRows";
import { EjesAcceptList, chosenCountsOf, isSplitAcceptable, splitKeyOf, toggleSplitAcceptance, type EjesAcceptView } from "./ejesAccept";
import { acceptedCountTextOf, EJES_ACCEPT_TEXT } from "./ejesAcceptTexts";
import acceptStyles from "./EjesAccept.module.css";
import { EJES_COMPACT_TEXT } from "./compact/ejesCompactTexts";
import { splitColumnsOf } from "./compact/ejesSplitColumns";
import { EjesSplitListFilters } from "./splitReview/EjesSplitListFilters";
import { EjesSplitReviewModal } from "./splitReview/EjesSplitReviewModal";
import { EjesSplitStatusCell } from "./splitReview/EjesSplitStatusCell";
import { EJES_SPLIT_REVIEW_TEXT } from "./splitReview/ejesSplitReviewTexts";
import { REASON_FILTER, type ReasonFilter } from "./splitReview/ejesSplitReviewView";
import { ATTENTION_FILTER, attentionCountsOf, splitMatchesAttention, sortSplitsByAttention, type AttentionFilter } from "./ejesCallesReportView";

const reasonMatches = (row: EjesSplitRow, reason: ReasonFilter): boolean => {
  if (reason === REASON_FILTER.AMBIGUOUS) return row.reviewPoints > 0;
  if (reason === REASON_FILTER.NO_GEOMETRY) return row.noGeometryPoints > 0;
  return true;
};

const streetMatches = (row: EjesSplitRow, street: string): boolean => {
  const term = street.trim().toLowerCase();
  return term === "" || (row.idcalle ?? "").toLowerCase().includes(term);
};

export interface EjesSplitsSectionProps {
  /** The split rows of the analysis, as listed. */
  rows: EjesSplitRow[];
  /** Every split the analysis counted. */
  total: number;
  accept: EjesAcceptView;
  /** The connection, tables and dry run of the wizard for the review; null while the wizard holds no password. */
  splitBase: EjesSplitPointsBase | null;
  onShowOnMap: (row: EjesSplitRow) => void;
}

/** The splits list with its filters, its status and review of each split (EJS-6) and the accept controls of EJ-24. */
export const EjesSplitsSection: React.FC<EjesSplitsSectionProps> = ({ rows, total, accept, splitBase, onShowOnMap }) => {
  const [reason, setReason] = useState<ReasonFilter>(REASON_FILTER.ALL);
  const [street, setStreet] = useState<string>("");
  const [attention, setAttention] = useState<AttentionFilter>(ATTENTION_FILTER.ALL);
  const [openSplit, setOpenSplit] = useState<EjesSplitRow | null>(null);
  const [capNote, setCapNote] = useState<string | null>(null);
  const chosen = chosenCountsOf(accept.pointChoices);
  const chosenOf = (row: EjesSplitRow): number => chosen.get(row.oldRef) ?? 0;
  const acceptedKeys = new Set(accept.keys.splits);
  const filtering = reason !== REASON_FILTER.ALL || street.trim() !== "" || attention !== ATTENTION_FILTER.ALL;
  const ordered = useMemo(() => sortSplitsByAttention(rows), [rows]);
  const attentionCounts = useMemo(() => attentionCountsOf(rows), [rows]);
  const listed = ordered.filter(
    (row) => reasonMatches(row, reason) && streetMatches(row, street) && splitMatchesAttention(row, attention)
  );
  const columns = splitColumnsOf(onShowOnMap, (row) => (
    <EjesSplitStatusCell row={row} chosen={chosenOf(row)} accepted={acceptedKeys.has(splitKeyOf(row))} onOpen={() => setOpenSplit(row)} />
  ));
  return (
    <>
      {filtering && <p className={acceptStyles.note}>{EJES_SPLIT_REVIEW_TEXT.FILTERED_LIST(listed.length, rows.length)}</p>}
      <p className={acceptStyles.note}>{EJES_ACCEPT_TEXT.SPLIT_NOTE}</p>
      {capNote !== null && <p className={acceptStyles.note}>{capNote}</p>}
      <EjesAcceptableRows
        list={EjesAcceptList.SPLITS}
        rows={listed}
        total={filtering ? listed.length : total}
        columns={columns}
        rowKey={splitKeyOf}
        acceptable={(row) => isSplitAcceptable(row, chosenOf(row))}
        notAcceptableText={EJES_COMPACT_TEXT.NOT_ACCEPTABLE}
        onToggleRow={(row, isAccepted) => setCapNote(toggleSplitAcceptance(accept, row.oldRef, isAccepted))}
        accept={accept}
        filters={
          <EjesSplitListFilters
            reason={reason}
            onReason={setReason}
            attention={attention}
            onAttention={setAttention}
            attentionCounts={attentionCounts}
            street={street}
            onStreet={setStreet}
          />
        }
        counterText={acceptedCountTextOf(accept.keys.splits.length, total)}
      />
      {openSplit !== null && (
        <EjesSplitReviewModal split={openSplit} base={splitBase} accept={accept} onClose={() => setOpenSplit(null)} />
      )}
    </>
  );
};
