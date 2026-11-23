"use client";

import React from "react";
import { Ban, Check, ListChecks, X } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { EjesMapCandidate } from "../../../jobs/ejes-calles/types";
import { metersTextOf } from "../ejesCallesReportView";
import { EJES_MANUAL_SPLIT_TEXT } from "../ejesAcceptTexts";
import { chosenSummaryOf, nearLengthSumOf } from "./manualSplitView";
import styles from "./manualSplit.module.css";

const ICON_SIZE = 15;

export interface ManualSplitFooterProps {
  /** The chosen candidates that the list shows, nearest first. */
  chosen: EjesMapCandidate[];
  /** Every chosen reftramo, new sections and ticked neighbours alike, shown or not: the clear button needs it. */
  selectedCount: number;
  /** The length in metres of the old section; null when its outline is not in the response. */
  oldLength: number | null;
  /** The access points that go to a chosen section and those that go to review; null while nothing is chosen. */
  pointSummary: { assigned: number; review: number } | null;
  /** The old sections joined into the one new section, the old section included; 0 when nothing is merged. */
  mergedOldCount: number;
  /** The apply is possible with the current choice (see `canApplyOf`). */
  canApply: boolean;
  /** The old section is marked as reviewed with no choice. */
  ignored: boolean;
  /** Every listed candidate is chosen already, or the piece limit is reached: nothing more to select. */
  allSelected: boolean;
  onApply: () => void;
  onClear: () => void;
  onSelectAll: () => void;
  onIgnore: () => void;
}

/** The live caption of the choice, the metres it covers near the old section, and the apply, clear and ignore buttons. */
export function ManualSplitFooter({
  chosen,
  selectedCount,
  oldLength,
  pointSummary,
  mergedOldCount,
  canApply,
  ignored,
  allSelected,
  onApply,
  onClear,
  onSelectAll,
  onIgnore,
}: ManualSplitFooterProps) {
  return (
    <div className={styles.footer}>
      <p className={styles.caption}>
        <span>{EJES_MANUAL_SPLIT_TEXT.CHOSEN_COUNT(chosen.length)}</span> <span>{chosenSummaryOf(chosen.length, mergedOldCount)}</span>
      </p>
      {pointSummary !== null && <p className={styles.hint}>{EJES_MANUAL_SPLIT_TEXT.POINTS_SUMMARY(pointSummary.assigned, pointSummary.review)}</p>}
      {oldLength !== null && (
        <p className={styles.hint}>{EJES_MANUAL_SPLIT_TEXT.NEAR_SUM(metersTextOf(nearLengthSumOf(chosen)), metersTextOf(oldLength))}</p>
      )}
      <div className={styles.actions}>
        <Button variant={ButtonVariant.SECONDARY} onClick={onSelectAll} disabled={allSelected}>
          <ListChecks size={ICON_SIZE} />
          <span>{EJES_MANUAL_SPLIT_TEXT.SELECT_ALL}</span>
        </Button>
        <Button variant={ButtonVariant.SECONDARY} onClick={onClear} disabled={selectedCount === 0}>
          <X size={ICON_SIZE} />
          <span>{EJES_MANUAL_SPLIT_TEXT.CLEAR_SELECTION}</span>
        </Button>
        <Button variant={ButtonVariant.SECONDARY} onClick={onIgnore}>
          <Ban size={ICON_SIZE} />
          <span>{ignored ? EJES_MANUAL_SPLIT_TEXT.UNIGNORE : EJES_MANUAL_SPLIT_TEXT.IGNORE}</span>
        </Button>
        <Button onClick={onApply} disabled={!canApply}>
          <Check size={ICON_SIZE} />
          <span>{EJES_MANUAL_SPLIT_TEXT.APPLY}</span>
        </Button>
      </div>
      <p className={styles.hint}>{EJES_MANUAL_SPLIT_TEXT.APPLY_NOTE}</p>
    </div>
  );
}
