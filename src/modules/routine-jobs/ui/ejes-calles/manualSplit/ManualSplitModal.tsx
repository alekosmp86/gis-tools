"use client";

import React from "react";
import type { EjesRemovalRow, EjesManualSplit } from "../../../jobs/ejes-calles/types";
import type { EjesGeometryMapBase } from "../../shared/clientTypes";
import { OutlineMapModal } from "../../shared/map/OutlineMapModal";
import { EJES_CONNECTION_NOTICE } from "../EjesMapModal";
import { EJES_MANUAL_SPLIT_TEXT } from "../ejesAcceptTexts";
import { manualSplitOf, type EjesManualSplitChange } from "../ejesAccept";
import { ManualSplitContent } from "./ManualSplitContent";
import styles from "./manualSplit.module.css";

/** The held removals the modal walks through, in list order, and the one on screen. */
export interface ManualSplitReview {
  rows: EjesRemovalRow[];
  index: number;
}

export interface ManualSplitModalProps {
  /** Null while closed. */
  review: ManualSplitReview | null;
  /** The connection of the wizard for the map; null when the wizard holds no password. */
  base: EjesGeometryMapBase | null;
  manualSplits: readonly EjesManualSplit[];
  onChange: (change: EjesManualSplitChange) => void;
  onNavigate: (index: number) => void;
  onClose: () => void;
}

/**
 * The map where the user decides the new sections that replace a held removal. Applying stores the choice and moves to the next
 * held row, or closes after the last one. Mounted only while open; each row starts from its own stored choice.
 */
export function ManualSplitModal({ review, base, manualSplits, onChange, onNavigate, onClose }: ManualSplitModalProps) {
  if (review === null) return null;
  const row = review.rows[review.index];
  if (row === undefined) return null;
  const apply = (newRefs: string[]) => {
    onChange({ oldRef: row.ref, newRefs });
    if (review.index + 1 < review.rows.length) onNavigate(review.index + 1);
    else onClose();
  };
  return (
    <OutlineMapModal
      title={EJES_MANUAL_SPLIT_TEXT.TITLE(row.ref)}
      navigation={{ index: review.index, total: review.rows.length, onNavigate }}
      onClose={onClose}
    >
      {base === null ? (
        <p className={styles.notice}>{EJES_CONNECTION_NOTICE}</p>
      ) : (
        <ManualSplitContent
          key={row.ref}
          row={row}
          base={base}
          storedRefs={manualSplitOf(manualSplits, row.ref)?.newRefs ?? []}
          onApply={apply}
        />
      )}
    </OutlineMapModal>
  );
}
