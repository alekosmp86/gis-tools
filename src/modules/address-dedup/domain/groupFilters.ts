import {
  Decision,
  DecisionFilter,
  FILTER_ALL,
  GroupSort,
  OTHER_FUENTE_COLUMN,
  REVIEW_REASONS,
} from "../constants";
import { isKnownFuente } from "./summaryView";
import type { AnalysisGroup, AnalysisRow, DecisionCounts, GroupFilterCriteria } from "../types";

export const EMPTY_CRITERIA: GroupFilterCriteria = {
  search: "",
  decision: DecisionFilter.ALL,
  reason: FILTER_ALL,
  fuente: FILTER_ALL,
  reviewOnly: false,
};

function normalizeSearch(search: string): string {
  return search.trim().toLowerCase();
}

export function hasActiveFilters(criteria: GroupFilterCriteria): boolean {
  return (
    normalizeSearch(criteria.search).length > 0 ||
    criteria.decision !== DecisionFilter.ALL ||
    criteria.reason !== FILTER_ALL ||
    criteria.fuente !== FILTER_ALL ||
    criteria.reviewOnly
  );
}

function matchesSearch(row: AnalysisRow, needle: string): boolean {
  if (needle.length === 0) return true;
  return [row.urn, row.padron, row.street_name, row.street_number, row.locality].some(
    (field) => field !== null && field.toLowerCase().includes(needle)
  );
}

function matchesFuente(row: AnalysisRow, fuente: string): boolean {
  if (fuente === FILTER_ALL) return true;
  if (fuente === OTHER_FUENTE_COLUMN) return !isKnownFuente(row.fuente);
  return row.fuente === fuente;
}

function rowMatches(row: AnalysisRow, criteria: GroupFilterCriteria, needle: string): boolean {
  return (
    (criteria.decision === DecisionFilter.ALL || row.decision === criteria.decision) &&
    (criteria.reason === FILTER_ALL || row.decision_reason === criteria.reason) &&
    matchesFuente(row, criteria.fuente) &&
    matchesSearch(row, needle)
  );
}

export function hasReviewRows(group: AnalysisGroup): boolean {
  return group.rows.some((row) => REVIEW_REASONS.includes(row.decision_reason));
}

export function countByDecision(group: AnalysisGroup): DecisionCounts {
  const remove = group.rows.filter((row) => row.decision === Decision.REMOVE).length;
  return { keep: group.rows.length - remove, remove };
}

/**
 * A group matches when one member satisfies every active member-level criterion at once; the
 * review toggle is group-level. Matching groups keep all their members, since the surrounding
 * rows are the context the tool exists to show.
 */
export function filterGroups(
  groups: ReadonlyArray<AnalysisGroup>,
  criteria: GroupFilterCriteria
): AnalysisGroup[] {
  const needle = normalizeSearch(criteria.search);

  return groups.filter(
    (group) =>
      (!criteria.reviewOnly || hasReviewRows(group)) &&
      group.rows.some((row) => rowMatches(row, criteria, needle))
  );
}

const SORT_KEY_BY_ORDER: Readonly<Record<GroupSort, (group: AnalysisGroup) => number>> = {
  [GroupSort.GROUP_ASC]: (group) => group.groupId,
  [GroupSort.SIZE_DESC]: (group) => -group.rows.length,
  [GroupSort.REMOVALS_DESC]: (group) => -countByDecision(group).remove,
};

/** Stable: ties fall back to ascending group id. */
export function sortGroups(groups: ReadonlyArray<AnalysisGroup>, order: GroupSort): AnalysisGroup[] {
  const sortKey = SORT_KEY_BY_ORDER[order];
  return [...groups].sort(
    (first, second) => sortKey(first) - sortKey(second) || first.groupId - second.groupId
  );
}

/**
 * Fuente options present in the data: the known fuentes sorted, then one "other" option when any
 * row has a fuente outside ANTEL/TLK/IDE (empty included), matching the summary matrix column.
 */
export function listFuentes(groups: ReadonlyArray<AnalysisGroup>): string[] {
  const present = new Set(groups.flatMap((group) => group.rows.map((row) => row.fuente)));
  const known = [...present].filter(isKnownFuente).sort((first, second) => first.localeCompare(second));
  const hasOther = [...present].some((fuente) => !isKnownFuente(fuente));
  return hasOther ? [...known, OTHER_FUENTE_COLUMN] : known;
}
