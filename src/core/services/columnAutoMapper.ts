export const MatchKind = {
  EXACT: "exact",
  CASE_INSENSITIVE: "caseInsensitive",
  NORMALIZED: "normalized",
  TRUNCATED: "truncated",
  SIMILAR: "similar",
} as const;

export type MatchKind = (typeof MatchKind)[keyof typeof MatchKind];

export interface AutoMatch {
  source: string;
  kind: MatchKind;
}

export interface AutoMapOptions {
  excludeSources?: readonly string[];
}

type MatchPredicate = (source: string, target: string) => boolean;

interface MatchTier {
  kind: MatchKind;
  matches: MatchPredicate;
}

interface MatchPair {
  target: string;
  source: string;
}

interface MatchState {
  result: Record<string, AutoMatch>;
  sources: string[];
  targets: string[];
}

const DBF_FIELD_MAX_LENGTH = 10;
const SIMILAR_MIN_LENGTH = 5;
const COMBINING_MARKS = /[̀-ͯ]/g;
const NON_ALPHANUMERIC = /[^a-z0-9]/g;

export function normalizeColumnName(columnName: string): string {
  return columnName.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase().replace(NON_ALPHANUMERIC, "");
}

function damerauLevenshteinDistance(left: string, right: string): number {
  const table = Array.from({ length: left.length + 1 }, (_row, rowIndex) =>
    Array.from({ length: right.length + 1 }, (_column, columnIndex) => Math.max(rowIndex, columnIndex))
  );
  for (let rowIndex = 1; rowIndex <= left.length; rowIndex += 1) {
    for (let columnIndex = 1; columnIndex <= right.length; columnIndex += 1) {
      table[rowIndex][columnIndex] = minimumEditCost(left, right, table, rowIndex, columnIndex);
    }
  }
  return table[left.length][right.length];
}

function minimumEditCost(left: string, right: string, table: number[][], rowIndex: number, columnIndex: number): number {
  const substitutionCost = left[rowIndex - 1] === right[columnIndex - 1] ? 0 : 1;
  const editCost = Math.min(
    table[rowIndex - 1][columnIndex] + 1,
    table[rowIndex][columnIndex - 1] + 1,
    table[rowIndex - 1][columnIndex - 1] + substitutionCost
  );
  return isAdjacentTransposition(left, right, rowIndex, columnIndex)
    ? Math.min(editCost, table[rowIndex - 2][columnIndex - 2] + 1)
    : editCost;
}

function isAdjacentTransposition(left: string, right: string, rowIndex: number, columnIndex: number): boolean {
  return (
    rowIndex > 1 &&
    columnIndex > 1 &&
    left[rowIndex - 1] === right[columnIndex - 2] &&
    left[rowIndex - 2] === right[columnIndex - 1]
  );
}

const matchesExact: MatchPredicate = (source, target) => source === target;

const matchesCaseInsensitive: MatchPredicate = (source, target) => source.toLowerCase() === target.toLowerCase();

const matchesNormalized: MatchPredicate = (source, target) => {
  const normalizedSource = normalizeColumnName(source);
  return normalizedSource !== "" && normalizedSource === normalizeColumnName(target);
};

const matchesTruncated: MatchPredicate = (source, target) => {
  const normalizedSource = normalizeColumnName(source);
  const normalizedTarget = normalizeColumnName(target);
  return (
    source.length === DBF_FIELD_MAX_LENGTH &&
    normalizedSource !== "" &&
    normalizedTarget.length > DBF_FIELD_MAX_LENGTH &&
    normalizedTarget.startsWith(normalizedSource)
  );
};

const matchesSimilar: MatchPredicate = (source, target) => {
  const normalizedSource = normalizeColumnName(source);
  const normalizedTarget = normalizeColumnName(target);
  return (
    Math.min(normalizedSource.length, normalizedTarget.length) >= SIMILAR_MIN_LENGTH &&
    damerauLevenshteinDistance(normalizedSource, normalizedTarget) === 1
  );
};

const MATCH_TIERS: readonly MatchTier[] = [
  { kind: MatchKind.EXACT, matches: matchesExact },
  { kind: MatchKind.CASE_INSENSITIVE, matches: matchesCaseInsensitive },
  { kind: MatchKind.NORMALIZED, matches: matchesNormalized },
  { kind: MatchKind.TRUNCATED, matches: matchesTruncated },
  { kind: MatchKind.SIMILAR, matches: matchesSimilar },
];

const uniqueValues = (values: readonly string[]): string[] => Array.from(new Set(values));

function collectCandidatePairs(targets: string[], sources: string[], matches: MatchPredicate): MatchPair[] {
  return targets.flatMap((target) =>
    sources.filter((source) => matches(source, target)).map((source): MatchPair => ({ target, source }))
  );
}

function countOccurrences(values: string[]): Map<string, number> {
  return values.reduce((counts, value) => counts.set(value, (counts.get(value) ?? 0) + 1), new Map<string, number>());
}

function findUniquePairs(pairs: MatchPair[]): MatchPair[] {
  const targetCounts = countOccurrences(pairs.map((pair) => pair.target));
  const sourceCounts = countOccurrences(pairs.map((pair) => pair.source));
  return pairs.filter((pair) => targetCounts.get(pair.target) === 1 && sourceCounts.get(pair.source) === 1);
}

function applyMatchTier(state: MatchState, tier: MatchTier): MatchState {
  const accepted = findUniquePairs(collectCandidatePairs(state.targets, state.sources, tier.matches));
  const matchedTargets = new Set(accepted.map((pair) => pair.target));
  const consumedSources = new Set(accepted.map((pair) => pair.source));
  const acceptedEntries = accepted.map((pair): [string, AutoMatch] => [pair.target, { source: pair.source, kind: tier.kind }]);
  return {
    result: { ...state.result, ...Object.fromEntries(acceptedEntries) },
    sources: state.sources.filter((source) => !consumedSources.has(source)),
    targets: state.targets.filter((target) => !matchedTargets.has(target)),
  };
}

export function autoMapColumns(
  sourceColumns: readonly string[],
  targetColumns: readonly string[],
  options: AutoMapOptions = {}
): Record<string, AutoMatch> {
  const excludedSources = new Set(options.excludeSources ?? []);
  const initialState: MatchState = {
    result: {},
    sources: uniqueValues(sourceColumns).filter((source) => !excludedSources.has(source)),
    targets: uniqueValues(targetColumns),
  };
  return MATCH_TIERS.reduce(applyMatchTier, initialState).result;
}
