import { ACCEPTED_CHOICES_LIMIT, ACCEPTED_KEYS_LIMIT, REPLACEMENT_PIECES } from "../../jobs/ejes-ide/constants";
import type { EjesCounts, EjesManualSplit, EjesRemovalRow, EjesRenamedStreetRow, EjesSplitRow, EjesTwinPick } from "../../jobs/ejes-ide/types";
import type { EjesAcceptedRequest, EjesManualSplitRequest, EjesPointChoiceRequest } from "./shared/ejesIdeClientTypes";
import { EJES_ACCEPT_TEXT } from "./ejesAcceptTexts";
import { renameChoiceOf, renamedStreetNeedsChoice, type EjesRenamedNameChoice } from "./ejesRenamedStreetsView";
import { EJES_SPLIT_REVIEW_TEXT } from "./splitReview/ejesSplitReviewTexts";

export const EjesAcceptList = {
  SPLITS: "splits",
  PLAIN_REMOVALS: "plainRemovals",
  MERGES: "merges",
  TWIN_REMOVALS: "twinRemovals",
  RENAMED_STREETS: "renamedStreets",
} as const;

export type EjesAcceptList = (typeof EjesAcceptList)[keyof typeof EjesAcceptList];

/** A split without a `reftramo` has no accept key: its row key is its new pieces, so the rows stay distinct. */
export const splitKeyOf = (row: EjesSplitRow): string => (row.oldRef === "" ? `pieces:${row.newRefs.join("|")}` : row.oldRef);

/** The review points of a split the user must decide: the ambiguous ones and the ones with no geometry. */
export const pointReviewCountOf = (row: EjesSplitRow): number => row.reviewPoints + row.noGeometryPoints;

/** A split with one new section replaces its old section: its points move to that section and the old one goes. */
export const isReplacementSplit = (row: EjesSplitRow): boolean => row.newRefs.length === REPLACEMENT_PIECES;

/** A replacement with review points is not automatic: its points need the user's choices, as a split's do (EJS-17). */
export const isReplacementReview = (row: EjesSplitRow): boolean => isReplacementSplit(row) && pointReviewCountOf(row) > 0;

/** A plain removal applies only without access points: the load holds one that still has any (`has_points`), so it is not offered. */
export const isPlainRemovalAcceptable = (row: EjesRemovalRow): boolean => row.ref !== "" && row.points === 0;

export const plainRemovalNotAcceptableText = (row: EjesRemovalRow): string =>
  row.ref === "" ? EJES_ACCEPT_TEXT.NOT_ACCEPTABLE : EJES_ACCEPT_TEXT.NO_RECEIVING_SECTION;

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

/** The accepted keys of one analysis: splits by their old `reftramo`, plain removals by `reftramo`, merges by their new `reftramo`, renamed streets by `idcalle`. */
export interface EjesAcceptKeys {
  splits: readonly string[];
  plainRemovals: readonly string[];
  merges: readonly string[];
  twinRemovals: readonly string[];
  renamedStreets?: readonly string[];
}

/** The accepted keys, the point choices, and the analysis they were accepted on: a different analysis key means none of them apply. */
export interface EjesAcceptance extends EjesAcceptKeys {
  analysisKey: string;
  pointChoices: readonly EjesPointChoiceKey[];
  renamedNames?: readonly EjesRenamedNameChoice[];
}

export interface EjesAcceptChange {
  list: EjesAcceptList;
  keys: readonly string[];
  accepted: boolean;
}

/** The name the user chose for a renamed street with several names; a null name clears the choice. */
export interface EjesRenameChoiceChange {
  idcalle: string;
  name: string | null;
}

/** The choices of one split's review points: the points set to a piece, the points whose choice is cleared. */
export interface EjesPointChoicesChange {
  oldRef: string;
  set: readonly EjesPointChoiceRequest[];
  clear: readonly string[];
  /** The review points the split needs; an accepted split that loses one of its choices is no longer accepted. */
  needed: number;
}

/** The copy a `reftramo` keeps: a department and a locality, both named (a copy without one cannot be picked). */
export type EjesTwinPickCopy = Omit<EjesTwinPick, "ref">;

/** The copy the user keeps for one `reftramo`; a null copy clears its pick. */
export interface EjesTwinPickChange {
  ref: string;
  copy: EjesTwinPickCopy | null;
}

/** The new sections the user chose for one old section; null clears the choice of that old section. */
export interface EjesManualSplitChange {
  oldRef: string;
  newRefs: string[] | null;
}

/** An old section the user marked as reviewed with no new section to choose: UI only, never sent to the server. */
export interface EjesIgnoredRefChange {
  oldRef: string;
  ignored: boolean;
}

/** What a report needs to show and change the accepted keys, the point choices, the twin picks and the manual splits; absent on a read-only report. */
export interface EjesAcceptView {
  keys: EjesAcceptKeys;
  pointChoices: readonly EjesPointChoiceKey[];
  onChange: (change: EjesAcceptChange) => void;
  onPointChoicesChange: (change: EjesPointChoicesChange) => void;
  twinPicks: readonly EjesTwinPick[];
  onTwinPickChange: (change: EjesTwinPickChange) => void;
  manualSplits: readonly EjesManualSplit[];
  onManualSplitChange: (change: EjesManualSplitChange) => void;
  ignoredRefs?: readonly string[];
  onIgnoredRefChange?: (change: EjesIgnoredRefChange) => void;
  renameChoices?: readonly EjesRenamedNameChoice[];
  onRenameChoiceChange?: (change: EjesRenameChoiceChange) => void;
  canAnalyzeWithPicks: boolean;
  onAnalyzeWithPicks: () => void;
}

const NO_ACCEPT_KEYS: EjesAcceptKeys = { splits: [], plainRemovals: [], merges: [], twinRemovals: [] };
const NO_POINT_CHOICES: readonly EjesPointChoiceKey[] = [];
const NO_TWIN_PICKS: readonly EjesTwinPick[] = [];
const NO_MANUAL_SPLITS: readonly EjesManualSplit[] = [];
export const NO_IGNORED_REFS: readonly string[] = [];
export const NO_IGNORED_CHANGE = (): void => undefined;
const NO_RENAME_CHOICES: readonly EjesRenamedNameChoice[] = [];
export const NO_RENAME_CHANGE = (): void => undefined;

export function acceptKeysOf(acceptance: EjesAcceptance | null, analysisKey: string | undefined): EjesAcceptKeys {
  if (acceptance === null || analysisKey === undefined || acceptance.analysisKey !== analysisKey) return NO_ACCEPT_KEYS;
  return {
    splits: acceptance.splits,
    plainRemovals: acceptance.plainRemovals,
    merges: acceptance.merges,
    twinRemovals: acceptance.twinRemovals,
    renamedStreets: acceptance.renamedStreets,
  };
}

/** The keys one list holds; a list absent from an older acceptance holds none. */
export const acceptedKeysOfList = (keys: EjesAcceptKeys, list: EjesAcceptList): readonly string[] => keys[list] ?? [];

export function pointChoicesOf(acceptance: EjesAcceptance | null, analysisKey: string | undefined): readonly EjesPointChoiceKey[] {
  if (acceptance === null || analysisKey === undefined || acceptance.analysisKey !== analysisKey) return NO_POINT_CHOICES;
  return acceptance.pointChoices;
}

export function renameChoicesOf(acceptance: EjesAcceptance | null, analysisKey: string | undefined): readonly EjesRenamedNameChoice[] {
  if (acceptance === null || analysisKey === undefined || acceptance.analysisKey !== analysisKey) return NO_RENAME_CHOICES;
  return acceptance.renamedNames ?? NO_RENAME_CHOICES;
}

export const renameChoicesOfAccept = (accept: EjesAcceptView): readonly EjesRenamedNameChoice[] => accept.renameChoices ?? NO_RENAME_CHOICES;

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
  const next = keysAfter(acceptedKeysOfList(current, change.list), change.keys, change.accepted).keys;
  return { ...current, [change.list]: next };
}

/** Sets or clears the name of one renamed street. Clearing it also unaccepts the street: it is never sent without a name. */
export function renameChoiceAfter(acceptance: EjesAcceptance | null, analysisKey: string, change: EjesRenameChoiceChange): EjesAcceptance {
  const current = currentOf(acceptance, analysisKey);
  const others = (current.renamedNames ?? []).filter((choice) => choice.idcalle !== change.idcalle);
  if (change.name === null) {
    return acceptanceAfter({ ...current, renamedNames: others }, analysisKey, {
      list: EjesAcceptList.RENAMED_STREETS,
      keys: [change.idcalle],
      accepted: false,
    });
  }
  return { ...current, renamedNames: [...others, { idcalle: change.idcalle, name: change.name }] };
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

/** The twin picks after one `reftramo`'s copy is set (its pick replaced) or cleared. A new pick past the request limit is not added. */
export function twinPicksAfter(picks: readonly EjesTwinPick[], change: EjesTwinPickChange): EjesTwinPick[] {
  const others = picks.filter((pick) => pick.ref !== change.ref);
  if (change.copy === null) return others;
  if (others.length >= ACCEPTED_KEYS_LIMIT) return [...picks];
  return [...others, { ref: change.ref, department: change.copy.department, locality: change.copy.locality }];
}

export const twinPickOf = (picks: readonly EjesTwinPick[], ref: string): EjesTwinPick | undefined =>
  picks.find((pick) => pick.ref === ref);

export const twinPicksCapReached = (picks: readonly EjesTwinPick[]): boolean => picks.length >= ACCEPTED_KEYS_LIMIT;

/** The manual splits after one old section's choice is set (its pieces replaced) or cleared. A new one past the request limit is not added. */
export function manualSplitsAfter(splits: readonly EjesManualSplit[], change: EjesManualSplitChange): EjesManualSplit[] {
  const others = splits.filter((split) => split.oldRef !== change.oldRef);
  if (change.newRefs === null) return others;
  if (others.length >= ACCEPTED_KEYS_LIMIT) return [...splits];
  return [...others, { oldRef: change.oldRef, newRefs: change.newRefs }];
}

export const manualSplitOf = (splits: readonly EjesManualSplit[], oldRef: string): EjesManualSplit | undefined =>
  splits.find((split) => split.oldRef === oldRef);

/** The ignored old sections after one is marked or unmarked. Never mutates the list it is given. */
export function ignoredRefsAfter(ignoredRefs: readonly string[], change: EjesIgnoredRefChange): string[] {
  const others = ignoredRefs.filter((ref) => ref !== change.oldRef);
  return change.ignored ? [...others, change.oldRef] : others;
}

const manualSplitRequestOf = ({ oldRef, newRefs }: EjesManualSplit): EjesManualSplitRequest => ({ oldRef, newRefs });

/** The manual splits as the Analizar re-run and the real run send them. */
export const manualSplitRequestsOf = (splits: readonly EjesManualSplit[]): EjesManualSplitRequest[] => splits.map(manualSplitRequestOf);

/** The analysis rows and the user's names the renamed streets of a request read. */
export interface EjesRenamedRequestInput {
  rows: readonly EjesRenamedStreetRow[];
  choices: readonly EjesRenamedNameChoice[];
}

const NO_RENAMED_INPUT: EjesRenamedRequestInput = { rows: [], choices: [] };

/** A street with several names is left out until its name is chosen: the server refuses it without one. */
const renamedStreetEntryOf = (idcalle: string, renamed: EjesRenamedRequestInput): { idcalle: string; name?: string }[] => {
  const choice = renameChoiceOf(renamed.choices, idcalle);
  const row = renamed.rows.find((candidate) => candidate.idcalle === idcalle);
  if (row !== undefined && renamedStreetNeedsChoice(row) && choice === undefined) return [];
  return [choice === undefined ? { idcalle } : { idcalle, name: choice.name }];
};

/** The renamed streets of the request; absent when none is sent, so older request shapes stay unchanged. */
const renamedStreetsRequestOf = (
  idcalles: readonly string[] | undefined,
  renamed: EjesRenamedRequestInput
): Pick<EjesAcceptedRequest, "renamedStreets"> => {
  const entries = (idcalles ?? []).flatMap((idcalle) => renamedStreetEntryOf(idcalle, renamed));
  return entries.length === 0 ? {} : { renamedStreets: entries };
};

/** The request of the accepted splits: each with the user's choices only, never a point the user did not decide. */
export const acceptedRequestOf = (
  keys: EjesAcceptKeys,
  pointChoices: readonly EjesPointChoiceKey[] = NO_POINT_CHOICES,
  twinPicks: readonly EjesTwinPick[] = NO_TWIN_PICKS,
  manualSplits: readonly EjesManualSplit[] = NO_MANUAL_SPLITS,
  renamed: EjesRenamedRequestInput = NO_RENAMED_INPUT
): EjesAcceptedRequest => {
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
    twinPicks: twinPicks.map(({ ref, department, locality }) => ({ ref, department, locality })),
    manualSplits: manualSplitRequestsOf(manualSplits),
    autoPlainRemovals: true,
    ...renamedStreetsRequestOf(keys.renamedStreets, renamed),
  };
};

/** The plain removals the lists show: only the held ones (with access points); the load removes the others by itself. Ordered by points, most first. */
export const heldPlainRemovalsOf = (rows: readonly EjesRemovalRow[]): EjesRemovalRow[] => rows.filter((row) => row.points > 0);

/** The plain removals the load removes by itself: every one without access points, counted from the analysis (the listed rows are capped, the counts are not). */
export const automaticPlainRemovalsOf = (counts: EjesCounts): number => counts.plainRemovals - counts.plainHeld;
