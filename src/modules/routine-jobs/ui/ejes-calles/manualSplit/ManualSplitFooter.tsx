"use client";

import React from "react";
import { Check, X } from "lucide-react";
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
  /** Every chosen reftramo, shown or not: the clear button needs it. */
  selectedCount: number;
  /** The length in metres of the old section; null when its outline is not in the response. */
  oldLength: number | null;
  onApply: () => void;
  onClear: () => void;
}

/** The live caption of the choice, the metres it covers near the old section, and the apply and clear buttons. */
export function ManualSplitFooter({ chosen, selectedCount, oldLength, onApply, onClear }: ManualSplitFooterProps) {
  return (
    <div className={styles.footer}>
      <p className={styles.caption}>
        <span>{EJES_MANUAL_SPLIT_TEXT.CHOSEN_COUNT(chosen.length)}</span> <span>{chosenSummaryOf(chosen.length)}</span>
      </p>
      {oldLength !== null && (
        <p className={styles.hint}>{EJES_MANUAL_SPLIT_TEXT.NEAR_SUM(metersTextOf(nearLengthSumOf(chosen)), metersTextOf(oldLength))}</p>
      )}
      <div className={styles.actions}>
        <Button variant={ButtonVariant.SECONDARY} onClick={onClear} disabled={selectedCount === 0}>
          <X size={ICON_SIZE} />
          <span>{EJES_MANUAL_SPLIT_TEXT.CLEAR_SELECTION}</span>
        </Button>
        <Button onClick={onApply} disabled={chosen.length === 0}>
          <Check size={ICON_SIZE} />
          <span>{EJES_MANUAL_SPLIT_TEXT.APPLY}</span>
        </Button>
      </div>
      <p className={styles.hint}>{EJES_MANUAL_SPLIT_TEXT.APPLY_NOTE}</p>
    </div>
  );
}
