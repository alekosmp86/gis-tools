import { useState } from "react";
import { buildDefaultColumnMapping, type ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import { autoMapColumns, type AutoMatch, type MatchKind } from "@/core/services/columnAutoMapper";
import type { InsertFieldDefault } from "@/core/types/comparison";

export interface ReplaceColumnMappingOptions {
  smart?: boolean;
  excludeSources?: string[];
}

interface MappingEdits {
  signature: string;
  sourceByTarget: Record<string, string | null>;
  defaults: Record<string, InsertFieldDefault>;
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

export function useReplaceColumnMapping(
  sourceColumns: string[],
  targetColumns: string[],
  options?: ReplaceColumnMappingOptions
) {
  const signature = `${sourceColumns.join("\u0000")}\u0001${targetColumns.join("\u0000")}`;
  const [edits, setEdits] = useState<MappingEdits>({ signature, sourceByTarget: {}, defaults: {} });
  const activeEdits = edits.signature === signature ? edits : { signature, sourceByTarget: {}, defaults: {} };

  const automatic: AutomaticMatches | null = options?.smart
    ? autoMapColumns(sourceColumns, targetColumns, { excludeSources: options.excludeSources })
    : null;
  const base = automatic
    ? { sourceByTarget: buildAutomaticSourceByTarget(targetColumns, automatic), defaults: {} }
    : buildDefaultColumnMapping(sourceColumns, targetColumns);
  const mapping: ReplaceColumnMapping = {
    sourceByTarget: { ...base.sourceByTarget, ...activeEdits.sourceByTarget },
    defaults: activeEdits.defaults,
  };
  const autoMatches: Record<string, MatchKind> = automatic
    ? collectCurrentAutoMatches(automatic, mapping.sourceByTarget)
    : {};

  const setSource = (targetColumn: string, sourceColumn: string | null) =>
    setEdits({ ...activeEdits, sourceByTarget: { ...activeEdits.sourceByTarget, [targetColumn]: sourceColumn } });

  const setDefault = (targetColumn: string, fieldDefault: InsertFieldDefault) =>
    setEdits({ ...activeEdits, defaults: { ...activeEdits.defaults, [targetColumn]: fieldDefault } });

  return { mapping, autoMatches, setSource, setDefault };
}
