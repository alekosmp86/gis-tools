import { PAIR_STATUS, type PairTier } from "../jobs/actualizar-padron/constants";
import { pairChoiceKeyId, type PairChoiceKeyFields } from "../jobs/actualizar-padron/domain/pairChoiceKey";
import type { PadronKey, PadronPair, PairChoice } from "../jobs/actualizar-padron/types";

export type PairChoiceKey = Omit<PairChoice, "oldId">;

export interface PairCandidateView {
  oldId: number;
  oldType: string | null;
  oldLocality: string | null;
  oldNumber: string | null;
  tier: PairTier;
  overlap: number | null;
  areaRatio: number | null;
}

export interface AmbiguousGroupView {
  id: string;
  key: PairChoiceKey;
  department: string | null;
  locality: string | null;
  candidates: PairCandidateView[];
}

const filledOf = (value: string | null): value is string => value !== null && value.trim() !== "";

/** The key a choice is sent with. Null when the row lacks a field the request needs (never the case for a candidate, which comes from a non-skipped row). */
export const pairChoiceKeyOf = (key: PadronKey): PairChoiceKey | null => {
  if (!filledOf(key.typePadron) || !filledOf(key.number) || key.provinceId === null) return null;
  return { typePadron: key.typePadron, provinceId: key.provinceId, localityId: key.localityId, number: key.number };
};

/** The choice that pairs a listed pair: its new key and its old id. Null when the pair has no old id or an incomplete new key. */
export const choiceOfPair = (pair: PadronPair): PairChoice | null => {
  if (pair.oldId === null) return null;
  const key = pairChoiceKeyOf(pair.new);
  return key === null ? null : { ...key, oldId: pair.oldId };
};

/** A choice names one candidate of one group: two choices are the same when both the key and the old id match. */
const choiceSignatureOf = (choice: PairChoiceKeyFields & { oldId: number | null }): string =>
  JSON.stringify([pairChoiceKeyId(choice), choice.oldId]);

const candidateOf = (pair: PadronPair, oldId: number): PairCandidateView => ({
  oldId,
  oldType: pair.old.typePadron,
  oldLocality: pair.old.locality,
  oldNumber: pair.old.number,
  tier: pair.tier,
  overlap: pair.overlap,
  areaRatio: pair.areaRatio,
});

/** The ambiguous pairs of a dry-run or real-run report, one group per new key, in report order. */
export function ambiguousGroupsOf(pairs: readonly PadronPair[]): AmbiguousGroupView[] {
  const groups = new Map<string, AmbiguousGroupView>();
  for (const pair of pairs) {
    if (pair.status !== PAIR_STATUS.NOT_APPLIED_AMBIGUOUS || pair.oldId === null) continue;
    const key = pairChoiceKeyOf(pair.new);
    if (key === null) continue;
    const id = pairChoiceKeyId(key);
    const group = groups.get(id) ?? { id, key, department: pair.new.department, locality: pair.new.locality, candidates: [] };
    groups.set(id, { ...group, candidates: [...group.candidates, candidateOf(pair, pair.oldId)] });
  }
  return [...groups.values()];
}

export const choiceFor = (group: AmbiguousGroupView, oldId: number | null): PairChoice => ({ ...group.key, oldId });

export const choiceOfGroup = (choices: readonly PairChoice[], group: AmbiguousGroupView): PairChoice | undefined =>
  choices.find((choice) => pairChoiceKeyId(choice) === group.id);

/** A choice replaces the earlier choice of the same new key. */
export function withChoice(choices: readonly PairChoice[], choice: PairChoice): PairChoice[] {
  const id = pairChoiceKeyId(choice);
  return [...choices.filter((item) => pairChoiceKeyId(item) !== id), choice];
}

export function withoutChoice(choices: readonly PairChoice[], choice: PairChoice): PairChoice[] {
  const id = pairChoiceKeyId(choice);
  return choices.filter((item) => pairChoiceKeyId(item) !== id);
}

/** Bulk form of withChoice: one pass, so a long list of pending pairs stays linear. Also keys the accepted geometries. */
export function withChoices<Item extends PairChoiceKeyFields>(choices: readonly Item[], incoming: readonly Item[]): Item[] {
  const byKey = new Map<string, Item>(choices.map((item) => [pairChoiceKeyId(item), item]));
  for (const choice of incoming) byKey.set(pairChoiceKeyId(choice), choice);
  return [...byKey.values()];
}

/** Bulk form of withoutChoice: removes every entry whose new key is one of the given entries' keys. */
export function withoutChoices<Item extends PairChoiceKeyFields>(choices: readonly Item[], removed: readonly PairChoiceKeyFields[]): Item[] {
  const ids = new Set(removed.map(pairChoiceKeyId));
  return choices.filter((item) => !ids.has(pairChoiceKeyId(item)));
}

/** Old ids chosen for other groups: the request refuses the same old id for two new keys, so these candidates stay disabled. */
export function takenOldIds(choices: readonly PairChoice[], group: AmbiguousGroupView): ReadonlySet<number> {
  return new Set(choices.flatMap((choice) => (pairChoiceKeyId(choice) === group.id || choice.oldId === null ? [] : [choice.oldId])));
}

export const chosenGroupCount = (groups: readonly AmbiguousGroupView[], choices: readonly PairChoice[]): number =>
  groups.filter((group) => choiceOfGroup(choices, group) !== undefined).length;

/** Same set of choices, order-insensitive: the key and the old id of each one. */
export function sameChoices(first: readonly PairChoice[], second: readonly PairChoice[]): boolean {
  const firstSignatures = new Set(first.map(choiceSignatureOf));
  const secondSignatures = new Set(second.map(choiceSignatureOf));
  return firstSignatures.size === secondSignatures.size && [...firstSignatures].every((signature) => secondSignatures.has(signature));
}

const appliedSignaturesOf = (pairs: readonly PadronPair[]): Set<string> =>
  new Set(
    pairs.flatMap((pair) =>
      pair.status === PAIR_STATUS.APPLIED && pair.oldId !== null ? [choiceSignatureOf({ ...pair.new, oldId: pair.oldId })] : [],
    ),
  );

/**
 * The current choices whose own submitted version did not end as an APPLIED pair in the shown run. A choice picked after that run
 * is not in `submitted`, so it is never reported as failed.
 */
export function unappliedChoicesOf(
  current: readonly PairChoice[],
  submitted: readonly PairChoice[],
  pairs: readonly PadronPair[],
): PairChoice[] {
  const applied = appliedSignaturesOf(pairs);
  const failed = new Set(
    submitted.filter((choice) => choice.oldId !== null).map(choiceSignatureOf).filter((signature) => !applied.has(signature)),
  );
  return current.filter((choice) => choice.oldId !== null && failed.has(choiceSignatureOf(choice)));
}

export const isUnappliedGroup = (group: AmbiguousGroupView, unappliedChoices: readonly PairChoice[]): boolean =>
  unappliedChoices.some((choice) => pairChoiceKeyId(choice) === group.id);

export const PairChoiceState = {
  APPLIED: "APPLIED",
  UNAPPLIED: "UNAPPLIED",
  NOT_PAIRED: "NOT_PAIRED",
} as const;
export type PairChoiceState = (typeof PairChoiceState)[keyof typeof PairChoiceState];

export interface ListedPairChoice {
  choice: PairChoice;
  state: PairChoiceState;
}

const stateOfChoice = (choice: PairChoice, applied: ReadonlySet<string>): PairChoiceState => {
  if (choice.oldId === null) return PairChoiceState.NOT_PAIRED;
  return applied.has(choiceSignatureOf(choice)) ? PairChoiceState.APPLIED : PairChoiceState.UNAPPLIED;
};

/**
 * The current choices listed apart from their group cards: every choice whose group is not on screen (applied, not paired, or gone
 * from the report), plus the failed ones, which stay listed even when their card shows. A choice whose card shows and did not fail
 * is left to that card, so the list and the cards never duplicate each other.
 */
export function listedChoicesOf(
  current: readonly PairChoice[],
  submitted: readonly PairChoice[],
  pairs: readonly PadronPair[],
  groups: readonly AmbiguousGroupView[],
): ListedPairChoice[] {
  const applied = appliedSignaturesOf(pairs);
  const failed = new Set(unappliedChoicesOf(current, submitted, pairs).map(choiceSignatureOf));
  const onScreen = new Set(groups.map((group) => group.id));
  return current.flatMap((choice) => {
    const listed = failed.has(choiceSignatureOf(choice)) || !onScreen.has(pairChoiceKeyId(choice));
    return listed ? [{ choice, state: stateOfChoice(choice, applied) }] : [];
  });
}
