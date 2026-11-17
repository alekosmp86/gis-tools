"use client";

import React from "react";
import { Check, CheckCheck, X } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import { EJES_SPLIT_REVIEW_TEXT } from "./ejesSplitReviewTexts";
import styles from "./EjesSplitReview.module.css";

const ICON_SIZE = 15;

export interface EjesSplitReviewFooterProps {
  suggestedCount: number;
  acceptable: boolean;
  accepted: boolean;
  /** A note on the bulk or the split decision (a cap reached, a partial suggestion); null when there is none. */
  note: string | null;
  onAcceptSuggested: () => void;
  onToggleSplit: () => void;
}

/** The bulk "Aceptar sugeridos" of the split and its own accept switch, which the split list shows once every point has a destination. */
export const EjesSplitReviewFooter: React.FC<EjesSplitReviewFooterProps> = ({
  suggestedCount,
  acceptable,
  accepted,
  note,
  onAcceptSuggested,
  onToggleSplit,
}) => (
  <footer className={styles.footer}>
    <div className={styles.footerActions}>
      <Button variant={ButtonVariant.SECONDARY} onClick={onAcceptSuggested} disabled={suggestedCount === 0}>
        <CheckCheck size={ICON_SIZE} />
        <span>{EJES_SPLIT_REVIEW_TEXT.ACCEPT_SUGGESTED}</span>
      </Button>
      <Button variant={ButtonVariant.SECONDARY} onClick={onToggleSplit} disabled={!acceptable && !accepted}>
        {accepted ? <X size={ICON_SIZE} /> : <Check size={ICON_SIZE} />}
        <span>{accepted ? EJES_SPLIT_REVIEW_TEXT.REJECT_SPLIT : EJES_SPLIT_REVIEW_TEXT.ACCEPT_SPLIT}</span>
      </Button>
    </div>
    <div>
      <p className={styles.note}>{EJES_SPLIT_REVIEW_TEXT.ACCEPT_SUGGESTED_HINT(suggestedCount)}</p>
      {!acceptable && !accepted && <p className={styles.note}>{EJES_SPLIT_REVIEW_TEXT.SPLIT_NOT_YET}</p>}
      {accepted && <p className={styles.note}>{EJES_SPLIT_REVIEW_TEXT.ACCEPTED_NOTE}</p>}
      {note !== null && <p className={styles.note}>{note}</p>}
    </div>
  </footer>
);
