import { ACCEPTED_CHOICES_LIMIT, ACCEPTED_KEYS_LIMIT } from "../../jobs/ejes-calles/constants";
import type { EjesSplitRow } from "../../jobs/ejes-calles/types";
import type { EjesAcceptedRequest, EjesPointChoiceRequest } from "../shared/clientTypes";
import { EJES_SPLIT_REVIEW_TEXT } from "./splitReview/ejesSplitReviewTexts";

export const EjesAcceptList = {
  SPLITS: "splits",
  PLAIN_REMOVALS: "plainRemovals",
  MERGES: "merges",
  TWIN_REMOVALS: "twinRemovals",
} as const;

export type EjesAcceptList = (typeof EjesAcceptList)[keyof typeof EjesAcceptList];

/** A split without a `reftramo` has no accept key: its row key is its new pieces, so the rows stay distinct. */
export const splitKeyOf = (row: EjesSplitRow): string => (row.oldRef === "" ? `pieces:${row.newRefs.join("|")}` : row.oldRef);

/** The review points of a split the user must decide: the ambiguous ones and the ones with no geometry. */
export const pointReviewCountOf = (row: EjesSplitRow): number => row.reviewPoints + row.noGeometryPoints;

/**
 * A split is accepted only when the load does not hold it whatever the user chooses (`heldReason`, the analysis's own rules), its review
 * points were all stored (`incompleteReview`), it has a `reftramo`, no point linked by `road_section.id` (points_by_id) and every one of
 * its review points has a choice of the user (EJS-6). `chosenCount` is the number of choices made on that split.
 */
export const isSplitAcceptable = (row: EjesSplitRow, chosenCount: number): boolean =>
  row.oldRef !== "" &&
  row.heldReason === null &&
  !row.incompleteReview &&
  row.points === row.refPoints &&
  chosenCount >= pointReviewCountOf(row);

/** One destination the user chose for a review point of a split, keyed like the acceptance (by the split's old `reftramo`). */
export interface EjesPointChoiceKey extends EjesPointChoiceRequest {
  oldRef: string;
}

/** The accepted keys of one analysis: splits by their old `reftramo`, plain removals by `reftramo`, merges by their new `reftramo`. */
export interface EjesAcceptKeys {
  splits: readonly string[];
  plainRemovals: readonly string[];
  merges: readonly string[];
  twinRemovals: readonly string[];
}

/** The accepted keys, the point choices, and the analysis they were accepted on: a different analysis key means none of them apply. */
export interface EjesAcceptance extends EjesAcceptKeys {
  analysisKey: string;
  pointChoices: readonly EjesPointChoiceKey[];
}

export interface EjesAcceptChange {
  list: EjesAcceptList;
  keys: readonly string[];
  accepted: boolean;
}

/** The choices of one split's review points: the points set to a piece, the points whose choice is cleared. */
export interface EjesPointChoicesChange {
  oldRef: string;
  set: readonly EjesPointChoiceRequest[];
  clear: readonly string[];
  /** The review points the split needs; an accepted split that loses one of its choices is no longer accepted. */
  needed: number;
}

/** What a report needs to show and change the accepted keys and the point choices; absent on a read-only report. */
export interface EjesAcceptView {
  keys: EjesAcceptKeys;
  pointChoices: readonly EjesPointChoiceKey[];
  onChange: (change: EjesAcceptChange) => void;
  onPointChoicesChange: (change: EjesPointChoicesChange) => void;
}

const NO_ACCEPT_KEYS: EjesAcceptKeys = { splits: [], plainRemovals: [], merges: [], twinRemovals: [] };
const NO_POINT_CHOICES: readonly EjesPointChoiceKey[] = [];

export function acceptKeysOf(acceptance: EjesAcceptance | null, analysisKey: string | undefined): EjesAcceptKeys {
  if (acceptance === null || analysisKey === undefined || acceptance.analysisKey !== analysisKey) return NO_ACCEPT_KEYS;
  return { splits: acceptance.splits, plainRemovals: acceptance.plainRemovals, merges: acceptance.merges, twinRemovals: acceptance.twinRemovals };
}

export function pointChoicesOf(acceptance: EjesAcceptance | null, analysisKey: string | undefined): readonly EjesPointChoiceKey[] {
  if (acceptance === null || analysisKey === undefined || acceptance.analysisKey !== analysisKey) return NO_POINT_CHOICES;
  return acceptance.pointChoices;
}

/** The chosen destinations per split, the number of choices each split holds. */
export const chosenCountsOf = (pointChoices: readonly EjesPointChoiceKey[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const choice of pointChoices) counts.set(choice.oldRef, (counts.get(choice.oldRef) ?? 0) + 1);
  return counts;
};

interface KeysAfter {
  keys: string[];
  capped: boolean;
}

/** Adds or removes keys of one list. Adding stops at the request limit: `capped` says the rest did not fit. */
function keysAfter(current: readonly string[], keys: readonly string[], accepted: boolean): KeysAfter {
  if (!accepted) {
    const dropped = new Set(keys);
    return { keys: current.filter((key) => !dropped.has(key)), capped: false };
  }
  const next = [...current];
  const present = new Set(current);
  for (const key of keys) {
    if (present.has(key)) continue;
    if (next.length >= ACCEPTED_KEYS_LIMIT) return { keys: next, capped: true };
    present.add(key);
    next.push(key);
  }
  return { keys: next, capped: false };
}

/** True when accepting `keys` on top of `current` would pass the request limit. */
export const acceptCapReachedBy = (current: readonly string[], keys: readonly string[]): boolean =>
  keysAfter(current, keys, true).capped;

/** True when the choices of the accepted splits would pass the request limit of destinations. */
export const choiceCapReached = (choiceCount: number): boolean => choiceCount > ACCEPTED_CHOICES_LIMIT;

/** The acceptance of this analysis, or an empty one when it was made on another analysis. */
function currentOf(acceptance: EjesAcceptance | null, analysisKey: string): EjesAcceptance {
  if (acceptance !== null && acceptance.analysisKey === analysisKey) return acceptance;
  return { analysisKey, ...NO_ACCEPT_KEYS, pointChoices: NO_POINT_CHOICES };
}

export function acceptanceAfter(acceptance: EjesAcceptance | null, analysisKey: string, change: EjesAcceptChange): EjesAcceptance {
  const current = currentOf(acceptance, analysisKey);
  const next = keysAfter(current[change.list], change.keys, change.accepted).keys;
  return { ...current, [change.list]: next };
}

/** Sets and clears the choices of one split. A split accepted before, that no longer holds every choice it needs, is taken out of the accepted splits. */
export function pointChoicesAfter(acceptance: EjesAcceptance | null, analysisKey: string, change: EjesPointChoicesChange): EjesAcceptance {
  const current = currentOf(acceptance, analysisKey);
  const touched = new Set([...change.set.map((choice) => choice.pointId), ...change.clear]);
  const kept = current.pointChoices.filter((choice) => choice.oldRef !== change.oldRef || !touched.has(choice.pointId));
  const added = change.set.map((choice) => ({ oldRef: change.oldRef, pointId: choice.pointId, newRef: choice.newRef }));
  const pointChoices = [...kept, ...added];
  const chosen = pointChoices.filter((choice) => choice.oldRef === change.oldRef).length;
  const splits = chosen >= change.needed ? current.splits : current.splits.filter((oldRef) => oldRef !== change.oldRef);
  return { ...current, splits, pointChoices };
}

/**
 * Accepts or rejects one split: the one place the splits list and the review modal change the accepted splits. `currentlyAccepted` is
 * the state the row shows. Returns the note of the request limit when it stopped the change, null otherwise.
 */
export function toggleSplitAcceptance(accept: EjesAcceptView, oldRef: string, currentlyAccepted: boolean): string | null {
  if (!currentlyAccepted && acceptCapReachedBy(accept.keys.splits, [oldRef])) return EJES_SPLIT_REVIEW_TEXT.SPLIT_CAP_NOTE;
  accept.onChange({ list: EjesAcceptList.SPLITS, keys: [oldRef], accepted: !currentlyAccepted });
  return null;
}

/** The request of the accepted splits: each with the user's choices only, never a point the user did not decide. */
export const acceptedRequestOf = (keys: EjesAcceptKeys, pointChoices: readonly EjesPointChoiceKey[] = NO_POINT_CHOICES): EjesAcceptedRequest => {
  const choicesBySplit = new Map<string, EjesPointChoiceRequest[]>();
  for (const choice of pointChoices) {
    const list = choicesBySplit.get(choice.oldRef) ?? [];
    list.push({ pointId: choice.pointId, newRef: choice.newRef });
    choicesBySplit.set(choice.oldRef, list);
  }
  return {
    splits: keys.splits.map((oldRef) => ({ oldRef, choices: choicesBySplit.get(oldRef) ?? [] })),
    plainRemovals: keys.plainRemovals.map((ref) => ({ ref })),
    merges: keys.merges.map((newRef) => ({ newRef })),
    twinRemovals: keys.twinRemovals.map((ref) => ({ ref })),
  };
};
