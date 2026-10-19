export const NO_HIGHLIGHT = -1;
export const FIRST_PROFILE_INDEX = 1;
const NEW_CONNECTION_INDEX = 0;
const NEW_CONNECTION_ID = "";

/**
 * Highlight to apply after the query changes: the first match for a non-blank query with matches,
 * otherwise nothing.
 */
export function highlightAfterQuery(query: string, matchCount: number): number {
  return query.trim().length > 0 && matchCount > 0 ? FIRST_PROFILE_INDEX : NO_HIGHLIGHT;
}

/**
 * Next highlight for an arrow key over `optionCount` options (index 0 is "new connection").
 * From no highlight, Down goes to the first option and Up to the last; otherwise it moves one step,
 * clamped at both ends without wrapping.
 */
export function highlightAfterArrow(
  current: number,
  key: "ArrowDown" | "ArrowUp",
  optionCount: number,
): number {
  if (key === "ArrowDown") {
    return current === NO_HIGHLIGHT ? NEW_CONNECTION_INDEX : Math.min(current + 1, optionCount - 1);
  }
  return current === NO_HIGHLIGHT ? optionCount - 1 : Math.max(current - 1, NEW_CONNECTION_INDEX);
}

/**
 * Profile id Enter should select: null when nothing is highlighted, "" for the "new connection"
 * option, otherwise the id of the highlighted profile.
 */
export function resolveEnterSelection(
  activeIndex: number,
  matchingProfiles: ReadonlyArray<{ id: string }>,
): string | null {
  if (activeIndex === NO_HIGHLIGHT) {
    return null;
  }
  if (activeIndex === NEW_CONNECTION_INDEX) {
    return NEW_CONNECTION_ID;
  }
  return matchingProfiles[activeIndex - FIRST_PROFILE_INDEX].id;
}
