import { pairChoiceKeyId, type PairChoiceKeyFields } from "../jobs/actualizar-padron/domain/pairChoiceKey";
import type { PairChoice } from "../jobs/actualizar-padron/types";

export const PendingChoiceState = {
  /** The current choices already name this pair. */
  ACCEPTED: "ACCEPTED",
  /** The pair can be accepted now. */
  OPEN: "OPEN",
  /** Another new key already chose this old id: the request would refuse the pair. */
  BLOCKED: "BLOCKED",
  /** The pair has no complete new key to choose. */
  NONE: "NONE",
} as const;

export type PendingChoiceState = (typeof PendingChoiceState)[keyof typeof PendingChoiceState];

export const PENDING_CHOICE_STATE_LABEL: Record<PendingChoiceState, string> = {
  [PendingChoiceState.ACCEPTED]: "Aceptado",
  [PendingChoiceState.OPEN]: "Pendiente",
  [PendingChoiceState.BLOCKED]: "Bloqueado: el id anterior ya está elegido",
  [PendingChoiceState.NONE]: "Sin clave para elegir",
};

/** The current choices by new key and the old ids they hold: built once per render, so each row's lookup is constant time. */
export interface ChoiceIndex {
  byKey: ReadonlyMap<string, PairChoice>;
  oldIds: ReadonlySet<number | null>;
}

export const choiceIndexOf = (choices: readonly PairChoice[]): ChoiceIndex => ({
  byKey: new Map(choices.map((choice) => [pairChoiceKeyId(choice), choice])),
  oldIds: new Set(choices.map((choice) => choice.oldId)),
});

/** The state of one pending pair (its choice, when it has one) against the indexed current choices. */
export function pendingChoiceStateIn(index: ChoiceIndex, choice: PairChoice | null): PendingChoiceState {
  if (choice === null) return PendingChoiceState.NONE;
  const same = index.byKey.get(pairChoiceKeyId(choice));
  if (same !== undefined && same.oldId === choice.oldId) return PendingChoiceState.ACCEPTED;
  return index.oldIds.has(choice.oldId) ? PendingChoiceState.BLOCKED : PendingChoiceState.OPEN;
}

/** The state of one pending pair (its choice, when it has one) against the current choices. */
export function pendingChoiceStateOf(choice: PairChoice | null, choices: readonly PairChoice[]): PendingChoiceState {
  return pendingChoiceStateIn(choiceIndexOf(choices), choice);
}

/** The choices that "Aceptar todos" adds: the open pairs only, each old id once. */
export function acceptableChoicesOf(choices: readonly (PairChoice | null)[], current: readonly PairChoice[]): PairChoice[] {
  const index = choiceIndexOf(current);
  const takenOldIds = new Set<number>();
  const accepted: PairChoice[] = [];
  for (const choice of choices) {
    if (choice === null || pendingChoiceStateIn(index, choice) !== PendingChoiceState.OPEN) continue;
    if (choice.oldId !== null && takenOldIds.has(choice.oldId)) continue;
    if (choice.oldId !== null) takenOldIds.add(choice.oldId);
    accepted.push(choice);
  }
  return accepted;
}

export interface PendingBulk {
  states: PendingChoiceState[];
  /** The open pairs "Aceptar todos" would add before the limit. */
  open: number;
  /** The choices "Aceptar todos" adds, within the limit. */
  acceptChoices: PairChoice[];
  truncated: boolean;
  /** The choices of the rows already accepted: what "Rechazar todos" removes. */
  acceptedChoices: PairChoice[];
  blocked: number;
}

export interface ChoicesWithinLimit<Item extends PairChoiceKeyFields = PairChoice> {
  choices: Item[];
  truncated: boolean;
}

/** The incoming entries that fit under the list limit of the request: stops at the first one that would exceed it. A same-key entry replaces, so it adds nothing. */
export function choicesWithinLimit<Item extends PairChoiceKeyFields>(
  incoming: readonly Item[],
  current: readonly PairChoiceKeyFields[],
  limit: number
): ChoicesWithinLimit<Item> {
  const keys = new Set(current.map(pairChoiceKeyId));
  const within: Item[] = [];
  for (const choice of incoming) {
    const id = pairChoiceKeyId(choice);
    const added = keys.has(id) ? 0 : 1;
    if (keys.size + added > limit) return { choices: within, truncated: true };
    keys.add(id);
    within.push(choice);
  }
  return { choices: within, truncated: false };
}

/** The bulk state of a list of pending pairs (their choices, in list order) against the current choices. */
export function pendingBulkOf(rowChoices: readonly (PairChoice | null)[], current: readonly PairChoice[], limit: number): PendingBulk {
  const index = choiceIndexOf(current);
  const states = rowChoices.map((choice) => pendingChoiceStateIn(index, choice));
  const open = acceptableChoicesOf(rowChoices, current);
  const within = choicesWithinLimit(open, current, limit);
  const acceptedChoices = rowChoices.flatMap((choice, i) => (choice !== null && states[i] === PendingChoiceState.ACCEPTED ? [choice] : []));
  const blocked = states.filter((state) => state === PendingChoiceState.BLOCKED).length;
  return { states, open: open.length, acceptChoices: within.choices, truncated: within.truncated, acceptedChoices, blocked };
}
