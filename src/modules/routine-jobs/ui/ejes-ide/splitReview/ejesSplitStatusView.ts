import { BadgeVariant } from "@/ui-kit/types/ui";
import type { EjesSplitRow } from "../../../jobs/ejes-ide/types";
import { EJES_COMPACT_TEXT } from "../compact/ejesCompactTexts";
import { isSplitAcceptable, pointReviewCountOf } from "../ejesAccept";
import { EJES_ACCEPT_TEXT } from "../ejesAcceptTexts";
import { SKIP_REASON_TEXT } from "../ejesLoadTexts";
import { EJES_SPLIT_REVIEW_TEXT } from "./ejesSplitReviewTexts";

const SplitStatusKind = {
  ACCEPTED: "accepted",
  READY: "ready",
  REVIEW: "review",
  HOLD: "hold",
} as const;

type SplitStatusKind = (typeof SplitStatusKind)[keyof typeof SplitStatusKind];

export interface SplitStatusView {
  kind: SplitStatusKind;
  text: string;
}

export const SPLIT_STATUS_BADGE: Record<SplitStatusKind, BadgeVariant> = {
  [SplitStatusKind.ACCEPTED]: BadgeVariant.ACTIVE,
  [SplitStatusKind.READY]: BadgeVariant.ACTIVE,
  [SplitStatusKind.REVIEW]: BadgeVariant.DEV,
  [SplitStatusKind.HOLD]: BadgeVariant.PLANNED,
};

const statusOf = (kind: SplitStatusKind, text: string): SplitStatusView => ({ kind, text });

/** The one status of a split: accepted, ready, waiting for its point choices (with progress), or held with the reason. */
export const splitStatusOf = (row: EjesSplitRow, chosenCount: number, accepted: boolean): SplitStatusView => {
  if (accepted) return statusOf(SplitStatusKind.ACCEPTED, EJES_COMPACT_TEXT.ACCEPTED);
  if (isSplitAcceptable(row, chosenCount)) return statusOf(SplitStatusKind.READY, EJES_COMPACT_TEXT.READY);
  if (row.heldReason !== null) return statusOf(SplitStatusKind.HOLD, SKIP_REASON_TEXT[row.heldReason]);
  if (row.incompleteReview) return statusOf(SplitStatusKind.HOLD, EJES_SPLIT_REVIEW_TEXT.INCOMPLETE_REVIEW);
  if (row.oldRef === "") return statusOf(SplitStatusKind.HOLD, EJES_ACCEPT_TEXT.NOT_ACCEPTABLE);
  const needed = pointReviewCountOf(row);
  if (chosenCount < needed) {
    return statusOf(SplitStatusKind.REVIEW, EJES_COMPACT_TEXT.REVIEW_PROGRESS(Math.min(chosenCount, needed), needed));
  }
  return statusOf(SplitStatusKind.REVIEW, EJES_ACCEPT_TEXT.NEEDS_REVIEW);
};
