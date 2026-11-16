import { ACCEPTED_KEYS_LIMIT } from "../../jobs/ejes-calles/constants";
import type { EjesAcceptedRequest } from "../shared/clientTypes";

export const EjesAcceptList = {
  PLAIN_REMOVALS: "plainRemovals",
  MERGES: "merges",
} as const;

export type EjesAcceptList = (typeof EjesAcceptList)[keyof typeof EjesAcceptList];

/** The accepted keys of one analysis: plain removals by `reftramo`, merges by their new `reftramo`. */
export interface EjesAcceptKeys {
  plainRemovals: readonly string[];
  merges: readonly string[];
}

/** The accepted keys, and the analysis they were accepted on: a different analysis key means none of them apply. */
export interface EjesAcceptance extends EjesAcceptKeys {
  analysisKey: string;
}

export interface EjesAcceptChange {
  list: EjesAcceptList;
  keys: readonly string[];
  accepted: boolean;
}

/** What a report needs to show and change the accepted keys; absent on a read-only report. */
export interface EjesAcceptView {
  keys: EjesAcceptKeys;
  onChange: (change: EjesAcceptChange) => void;
}

const NO_ACCEPT_KEYS: EjesAcceptKeys = { plainRemovals: [], merges: [] };

export function acceptKeysOf(acceptance: EjesAcceptance | null, analysisKey: string | undefined): EjesAcceptKeys {
  if (acceptance === null || analysisKey === undefined || acceptance.analysisKey !== analysisKey) return NO_ACCEPT_KEYS;
  return { plainRemovals: acceptance.plainRemovals, merges: acceptance.merges };
}

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

export function acceptanceAfter(acceptance: EjesAcceptance | null, analysisKey: string, change: EjesAcceptChange): EjesAcceptance {
  const current = acceptKeysOf(acceptance, analysisKey);
  if (change.list === EjesAcceptList.MERGES) {
    return { analysisKey, ...current, merges: keysAfter(current.merges, change.keys, change.accepted).keys };
  }
  return { analysisKey, ...current, plainRemovals: keysAfter(current.plainRemovals, change.keys, change.accepted).keys };
}

export const acceptedRequestOf = (keys: EjesAcceptKeys): EjesAcceptedRequest => ({
  plainRemovals: keys.plainRemovals.map((ref) => ({ ref })),
  merges: keys.merges.map((newRef) => ({ newRef })),
});
