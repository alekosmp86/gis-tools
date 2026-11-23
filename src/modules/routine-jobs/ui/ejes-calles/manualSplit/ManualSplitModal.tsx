"use client";

import React from "react";
import type { EjesRemovalRow, EjesManualSplit } from "../../../jobs/ejes-calles/types";
import type { EjesGeometryMapBase } from "../../shared/clientTypes";
import { OutlineMapModal } from "../../shared/map/OutlineMapModal";
import { EJES_CONNECTION_NOTICE } from "../EjesMapModal";
import { EJES_MANUAL_SPLIT_TEXT } from "../ejesAcceptTexts";
import { manualSplitOf, type EjesIgnoredRefChange, type EjesManualSplitChange } from "../ejesAccept";
import { ManualSplitContent } from "./ManualSplitContent";
import { afterIgnoreIndexOf, navigationTargetOf, resolvedPredicateOf } from "./manualResolutionView";
import { storedMergeRefsOf } from "./manualSplitView";
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
  ignoredRefs: readonly string[];
  onChange: (change: EjesManualSplitChange) => void;
  onIgnoredChange: (change: EjesIgnoredRefChange) => void;
  onNavigate: (index: number) => void;
  onClose: () => void;
}

/**
 * The map where the user decides the new sections that replace a held removal. Applying stores the choice and moves to the next
 * held row, or closes after the last one. Ignoring marks the row as reviewed and moves to the next unresolved one. The arrows skip
 * resolved rows. Mounted only while open; each row starts from its own stored choice, and the map stays mounted from row to row.
 */
export function ManualSplitModal({ review, base, manualSplits, ignoredRefs, onChange, onIgnoredChange, onNavigate, onClose }: ManualSplitModalProps) {
  if (review === null) return null;
  const row = review.rows[review.index];
  if (row === undefined) return null;
  const isResolved = resolvedPredicateOf(manualSplits, ignoredRefs);
  const isIgnored = ignoredRefs.includes(row.ref);
  const afterApply = () => {
    if (review.index + 1 < review.rows.length) onNavigate(review.index + 1);
    else onClose();
  };
  const apply = (newRefs: string[]) => {
    onChange({ oldRef: row.ref, newRefs });
    afterApply();
  };
  const applyMerge = (newRef: string, oldRefs: string[]) => {
    oldRefs.forEach((oldRef) => onChange({ oldRef, newRefs: [newRef] }));
    afterApply();
  };
  const ignore = () => {
    onIgnoredChange({ oldRef: row.ref, ignored: !isIgnored });
    if (isIgnored) return;
    const nextIndex = afterIgnoreIndexOf(review.rows, review.index, isResolved);
    if (nextIndex === null) onClose();
    else onNavigate(nextIndex);
  };
  const navigateTo = (target: number) => onNavigate(navigationTargetOf(review.rows, review.index, target, isResolved));
  return (
    <OutlineMapModal
      title={EJES_MANUAL_SPLIT_TEXT.TITLE(row.ref)}
      navigation={{ index: review.index, total: review.rows.length, onNavigate: navigateTo }}
      onClose={onClose}
    >
      {base === null ? (
        <p className={styles.notice}>{EJES_CONNECTION_NOTICE}</p>
      ) : (
        <ManualSplitContent
          row={row}
          base={base}
          storedRefs={manualSplitOf(manualSplits, row.ref)?.newRefs ?? []}
          storedMergeRefs={storedMergeRefsOf(manualSplits, row.ref)}
          ignored={isIgnored}
          onApply={apply}
          onApplyMerge={applyMerge}
          onIgnore={ignore}
        />
      )}
    </OutlineMapModal>
  );
}
