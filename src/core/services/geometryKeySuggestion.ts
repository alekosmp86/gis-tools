import type { ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import { SHP_GEOMETRY_SOURCE } from "@/core/types/shpReplace";

export const KeyOrigin = {
  REMEMBERED: "remembered",
  UNIQUE_KEY: "uniqueKey",
  NONE: "none",
} as const;

export type KeyOrigin = (typeof KeyOrigin)[keyof typeof KeyOrigin];

export interface KeySuggestion {
  readonly fields: string[];
  readonly origin: KeyOrigin;
}

export interface SuggestKeyFieldsParams {
  remembered: readonly string[] | null;
  uniqueKeys: readonly (readonly string[])[];
  mapping: ReplaceColumnMapping;
  dbfFields: readonly string[];
}

const NO_SUGGESTION: KeySuggestion = { fields: [], origin: KeyOrigin.NONE };

const isKeyableField = (field: string, dbfFields: ReadonlySet<string>): boolean =>
  field !== SHP_GEOMETRY_SOURCE && dbfFields.has(field);

const distinctInOrder = (values: readonly string[]): string[] => [...new Set(values)];

function suggestRemembered(remembered: readonly string[] | null, dbfFields: ReadonlySet<string>): KeySuggestion | null {
  if (!remembered || remembered.length === 0) return null;
  const fields = distinctInOrder(remembered);
  const allPresent = fields.every((field) => isKeyableField(field, dbfFields));
  return allPresent ? { fields, origin: KeyOrigin.REMEMBERED } : null;
}

function resolveKeyColumns(
  keyColumns: readonly string[],
  mapping: ReplaceColumnMapping,
  dbfFields: ReadonlySet<string>
): string[] | null {
  if (keyColumns.length === 0) return null;
  const sources: string[] = [];
  for (const column of keyColumns) {
    const source = mapping.sourceByTarget[column];
    if (!source || !isKeyableField(source, dbfFields)) return null;
    sources.push(source);
  }
  return distinctInOrder(sources);
}

function suggestUniqueKey(
  uniqueKeys: readonly (readonly string[])[],
  mapping: ReplaceColumnMapping,
  dbfFields: ReadonlySet<string>
): KeySuggestion | null {
  for (const keyColumns of uniqueKeys) {
    const fields = resolveKeyColumns(keyColumns, mapping, dbfFields);
    if (fields) return { fields, origin: KeyOrigin.UNIQUE_KEY };
  }
  return null;
}

export function pruneKeyFields(keyFields: readonly string[], dbfFields: readonly string[]): string[] {
  const dbfSet = new Set(dbfFields);
  return distinctInOrder(keyFields).filter((field) => dbfSet.has(field));
}

export interface ApplySuggestionInput {
  readonly consumed: boolean;
  readonly unifyEnabled: boolean;
  readonly keyFields: readonly string[];
  readonly suggestion: KeySuggestion;
}

export function shouldApplySuggestion({
  consumed,
  unifyEnabled,
  keyFields,
  suggestion,
}: ApplySuggestionInput): boolean {
  return (
    !consumed &&
    unifyEnabled &&
    keyFields.length === 0 &&
    suggestion.origin !== KeyOrigin.NONE &&
    suggestion.fields.length > 0
  );
}

export function suggestKeyFields({ remembered, uniqueKeys, mapping, dbfFields }: SuggestKeyFieldsParams): KeySuggestion {
  const dbfSet = new Set(dbfFields);
  return (
    suggestRemembered(remembered, dbfSet) ?? suggestUniqueKey(uniqueKeys, mapping, dbfSet) ?? NO_SUGGESTION
  );
}
