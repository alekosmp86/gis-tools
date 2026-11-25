"use client";

import React from "react";
import { ListChecks } from "lucide-react";
import { Badge } from "@/ui-kit/components/ui/Badge";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { EjesSplitRow } from "../../../jobs/ejes-ide/types";
import styles from "../compact/EjesCompact.module.css";
import { pointReviewCountOf } from "../ejesAccept";
import { EJES_SPLIT_REVIEW_TEXT } from "./ejesSplitReviewTexts";
import { SPLIT_STATUS_BADGE, splitStatusOf } from "./ejesSplitStatusView";

const ICON_SIZE = 15;

export interface EjesSplitStatusCellProps {
  row: EjesSplitRow;
  /** The destinations chosen on this split so far. */
  chosen: number;
  accepted: boolean;
  onOpen: () => void;
}

/** The status of a split and, when it has review points, the button that opens their review. */
export const EjesSplitStatusCell: React.FC<EjesSplitStatusCellProps> = ({ row, chosen, accepted, onOpen }) => {
  const status = splitStatusOf(row, chosen, accepted);
  const reviewable = pointReviewCountOf(row) > 0 && row.oldRef !== "";
  return (
    <div className={styles.statusCell}>
      <Badge variant={SPLIT_STATUS_BADGE[status.kind]}>
        <span className={styles.statusText}>{status.text}</span>
      </Badge>
      {reviewable && (
        <Button variant={ButtonVariant.SECONDARY} onClick={onOpen} aria-label={`${EJES_SPLIT_REVIEW_TEXT.OPEN_BUTTON} del tramo ${row.oldRef}`}>
          <ListChecks size={ICON_SIZE} />
          <span>{EJES_SPLIT_REVIEW_TEXT.OPEN_BUTTON}</span>
        </Button>
      )}
    </div>
  );
};
