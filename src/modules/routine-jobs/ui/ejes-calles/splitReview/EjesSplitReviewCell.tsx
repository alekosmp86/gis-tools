"use client";

import React from "react";
import { ListChecks } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { EjesSplitRow } from "../../../jobs/ejes-calles/types";
import { pointReviewCountOf } from "../ejesAccept";
import { EJES_SPLIT_REVIEW_TEXT } from "./ejesSplitReviewTexts";
import styles from "./EjesSplitReview.module.css";

const ICON_SIZE = 15;

export interface EjesSplitReviewCellProps {
  row: EjesSplitRow;
  /** The destinations chosen on this split so far. */
  chosen: number;
  onOpen: () => void;
}

/** The review column of a split row: its progress and the button of its review; a split with no review point has neither. */
export const EjesSplitReviewCell: React.FC<EjesSplitReviewCellProps> = ({ row, chosen, onOpen }) => {
  const needed = pointReviewCountOf(row);
  if (needed === 0) return <span>{EJES_SPLIT_REVIEW_TEXT.NO_REVIEW_POINTS}</span>;
  return (
    <div className={styles.cell}>
      <span className={styles.cellProgress}>{EJES_SPLIT_REVIEW_TEXT.PROGRESS_CELL(Math.min(chosen, needed), needed)}</span>
      {row.oldRef === "" ? (
        <span>{EJES_SPLIT_REVIEW_TEXT.NO_REFTRAMO}</span>
      ) : (
        <Button variant={ButtonVariant.SECONDARY} onClick={onOpen}>
          <ListChecks size={ICON_SIZE} />
          <span>{EJES_SPLIT_REVIEW_TEXT.OPEN_BUTTON}</span>
        </Button>
      )}
    </div>
  );
};
