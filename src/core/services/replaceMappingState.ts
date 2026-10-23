import { buildDefaultColumnMapping, type ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import { autoMapColumns, type AutoMatch, type MatchKind } from "@/core/services/columnAutoMapper";
import type { InsertFieldDefault } from "@/core/types/comparison";

export interface ReplaceMappingOptions {
  smart?: boolean;
  excludeSources?: string[];
}

export interface ReplaceMappingEdits {
  sourceByTarget: Record<string, string | null>;
  defaults: Record<string, InsertFieldDefault>;
}

export interface DeriveReplaceMappingInput {
  sourceColumns: string[];
  targetColumns: string[];
  edits: ReplaceMappingEdits;
  options?: ReplaceMappingOptions;
}

export interface DerivedReplaceMapping {
  mapping: ReplaceColumnMapping;
  autoMatches: Record<string, MatchKind>;
}

type AutomaticMatches = Record<string, AutoMatch>;

function buildAutomaticSourceByTarget(targetColumns: string[], automatic: AutomaticMatches): Record<string, string | null> {
  return Object.fromEntries(
    targetColumns.map((targetColumn): [string, string | null] => [targetColumn, automatic[targetColumn]?.source ?? null])
  );
}

function collectCurrentAutoMatches(
  automatic: AutomaticMatches,
  sourceByTarget: Record<string, string | null>
): Record<string, MatchKind> {
  const currentEntries = Object.entries(automatic)
    .filter(([targetColumn, match]) => sourceByTarget[targetColumn] === match.source)
    .map(([targetColumn, match]): [string, MatchKind] => [targetColumn, match.kind]);
  return Object.fromEntries(currentEntries);
}

function automaticMatchesOf(input: DeriveReplaceMappingInput): AutomaticMatches | null {
  return input.options?.smart
    ? autoMapColumns(input.sourceColumns, input.targetColumns, { excludeSources: input.options.excludeSources })
    : null;
}

function baseSourceByTargetOf(input: DeriveReplaceMappingInput, automatic: AutomaticMatches | null): Record<string, string | null> {
  return automatic
    ? buildAutomaticSourceByTarget(input.targetColumns, automatic)
    : buildDefaultColumnMapping(input.sourceColumns, input.targetColumns).sourceByTarget;
}

export function deriveReplaceMapping(input: DeriveReplaceMappingInput): DerivedReplaceMapping {
  const automatic = automaticMatchesOf(input);
  const mapping: ReplaceColumnMapping = {
    sourceByTarget: { ...baseSourceByTargetOf(input, automatic), ...input.edits.sourceByTarget },
    defaults: input.edits.defaults,
  };
  return {
    mapping,
    autoMatches: automatic ? collectCurrentAutoMatches(automatic, mapping.sourceByTarget) : {},
  };
}
