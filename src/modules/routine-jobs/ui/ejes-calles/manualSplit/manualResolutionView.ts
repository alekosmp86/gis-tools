import type { EjesManualSplit, EjesRemovalRow } from "../../../jobs/ejes-calles/types";
import { manualSplitOf } from "../ejesAccept";
import { EJES_MANUAL_SPLIT_TEXT } from "../ejesAcceptTexts";

export const ManualResolutionKind = {
  MANUAL: "manual",
  IGNORED: "ignored",
} as const;

type ManualResolutionKind = (typeof ManualResolutionKind)[keyof typeof ManualResolutionKind];

export type ManualResolution =
  | { kind: typeof ManualResolutionKind.MANUAL; newRefs: readonly string[] }
  | { kind: typeof ManualResolutionKind.IGNORED };

export type IsResolved = (oldRef: string) => boolean;

/** How an old section is resolved by the user: its chosen new sections, or ignored; null while it is open. */
const manualResolutionOf = (
  oldRef: string,
  manualSplits: readonly EjesManualSplit[],
  ignoredRefs: readonly string[]
): ManualResolution | null => {
  const manual = manualSplitOf(manualSplits, oldRef);
  if (manual !== undefined) return { kind: ManualResolutionKind.MANUAL, newRefs: manual.newRefs };
  return ignoredRefs.includes(oldRef) ? { kind: ManualResolutionKind.IGNORED } : null;
};

export const manualResolutionReaderOf =
  (manualSplits: readonly EjesManualSplit[], ignoredRefs: readonly string[]) =>
  (row: EjesRemovalRow): ManualResolution | null =>
    manualResolutionOf(row.ref, manualSplits, ignoredRefs);

export const resolvedPredicateOf =
  (manualSplits: readonly EjesManualSplit[], ignoredRefs: readonly string[]): IsResolved =>
  (oldRef) =>
    manualResolutionOf(oldRef, manualSplits, ignoredRefs) !== null;

export const resolvedCountOf = (rows: readonly EjesRemovalRow[], isResolved: IsResolved): number =>
  rows.filter((row) => isResolved(row.ref)).length;

export const resolutionTextOf = (resolution: ManualResolution): string =>
  resolution.kind === ManualResolutionKind.MANUAL
    ? EJES_MANUAL_SPLIT_TEXT.RESOLVED_BADGE(resolution.newRefs.join(", "))
    : EJES_MANUAL_SPLIT_TEXT.IGNORED_BADGE;

const nearestUnresolvedFrom = (rows: readonly EjesRemovalRow[], start: number, step: number, isResolved: IsResolved): number | null => {
  for (let index = start; index >= 0 && index < rows.length; index += step) {
    if (!isResolved(rows[index].ref)) return index;
  }
  return null;
};

/** The row a navigation lands on: the nearest unresolved row in its direction, or the adjacent row when there is none. */
export const navigationTargetOf = (rows: readonly EjesRemovalRow[], index: number, target: number, isResolved: IsResolved): number => {
  const step = Math.sign(target - index);
  if (step === 0) return target;
  return nearestUnresolvedFrom(rows, target, step, isResolved) ?? target;
};

/** The row after an ignore: the next unresolved one, else the previous one; null when every row is resolved. */
export const afterIgnoreIndexOf = (rows: readonly EjesRemovalRow[], index: number, isResolved: IsResolved): number | null =>
  nearestUnresolvedFrom(rows, index + 1, 1, isResolved) ?? nearestUnresolvedFrom(rows, index - 1, -1, isResolved);
