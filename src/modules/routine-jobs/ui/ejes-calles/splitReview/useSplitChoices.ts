"use client";

import { useMemo, useState } from "react";
import { ACCEPTED_CHOICES_LIMIT } from "../../../jobs/ejes-calles/constants";
import type { EjesSplitReviewPoint, EjesSplitRow } from "../../../jobs/ejes-calles/types";
import type { EjesPointChoiceRequest } from "../../shared/clientTypes";
import { choiceCapReached, pointReviewCountOf, toggleSplitAcceptance, type EjesAcceptView } from "../ejesAccept";
import { EJES_SPLIT_REVIEW_TEXT } from "./ejesSplitReviewTexts";
import { chosenByPointOf, suggestedChoicesOf } from "./ejesSplitReviewView";

export interface SplitChoices {
  chosenByPoint: ReadonlyMap<string, string>;
  /** The note of the last action: a request limit it reached, or a partial bulk; null when there is none. */
  note: string | null;
  suggestedCount: number;
  accepted: boolean;
  /** True when the point cannot take a new destination: the request limit of choices is reached. */
  choiceBlocked: (point: EjesSplitReviewPoint | undefined) => boolean;
  chooseCandidate: (point: EjesSplitReviewPoint, newRef: string) => void;
  acceptSuggested: () => void;
  toggleSplit: () => void;
}

/**
 * The choices of one split on the review: choosing a piece (choosing it again clears it), the bulk suggestion, and the split's own
 * accept switch, which is the same one the splits list uses. Nothing changes while `locked` (the stored points disagree with the summary).
 */
export function useSplitChoices(
  split: EjesSplitRow,
  accept: EjesAcceptView,
  points: readonly EjesSplitReviewPoint[],
  locked: boolean
): SplitChoices {
  const [note, setNote] = useState<string | null>(null);
  const chosenByPoint = useMemo(() => chosenByPointOf(accept.pointChoices, split.oldRef), [accept.pointChoices, split.oldRef]);
  const needed = pointReviewCountOf(split);
  const accepted = accept.keys.splits.includes(split.oldRef);
  const suggestions = suggestedChoicesOf(points, chosenByPoint);

  const setChoices = (set: EjesPointChoiceRequest[], clear: string[]) => {
    accept.onPointChoicesChange({ oldRef: split.oldRef, set, clear, needed });
  };

  const choiceBlocked = (point: EjesSplitReviewPoint | undefined): boolean =>
    locked || (point !== undefined && !chosenByPoint.has(point.pointId) && choiceCapReached(accept.pointChoices.length + 1));

  const chooseCandidate = (point: EjesSplitReviewPoint, newRef: string) => {
    if (locked) return;
    const previous = chosenByPoint.get(point.pointId);
    setNote(null);
    if (previous === newRef) {
      setChoices([], [point.pointId]);
      return;
    }
    if (previous === undefined && choiceCapReached(accept.pointChoices.length + 1)) {
      setNote(EJES_SPLIT_REVIEW_TEXT.CHOICE_CAP_NOTE);
      return;
    }
    setChoices([{ pointId: point.pointId, newRef }], []);
  };

  const acceptSuggested = () => {
    if (locked || suggestions.length === 0) return;
    const room = Math.max(0, ACCEPTED_CHOICES_LIMIT - accept.pointChoices.length);
    const set = suggestions.slice(0, room);
    if (set.length === 0) {
      setNote(EJES_SPLIT_REVIEW_TEXT.CHOICE_CAP_NOTE);
      return;
    }
    setNote(set.length < suggestions.length ? EJES_SPLIT_REVIEW_TEXT.ACCEPT_SUGGESTED_CAPPED(set.length) : null);
    setChoices(set, []);
  };

  const toggleSplit = () => {
    setNote(toggleSplitAcceptance(accept, split.oldRef, accepted));
  };

  return {
    chosenByPoint,
    note,
    suggestedCount: suggestions.length,
    accepted,
    choiceBlocked,
    chooseCandidate,
    acceptSuggested,
    toggleSplit,
  };
}
