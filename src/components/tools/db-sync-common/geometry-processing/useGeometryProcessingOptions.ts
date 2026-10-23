import { useMemo, useState } from "react";
import type { ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import {
  buildKeyMemoryId,
  getBrowserKeyStorage,
  loadRememberedKey,
  saveRememberedKey,
  type KeyMemoryTarget,
} from "@/core/services/geometryKeyMemory";
import {
  KeyOrigin,
  pruneKeyFields,
  shouldApplySuggestion,
  suggestKeyFields,
} from "@/core/services/geometryKeySuggestion";
import { DEFAULT_GEOMETRY_PROCESSING, type GeometryProcessingOptions } from "@/core/types/geometryProcessing";

export interface UseGeometryProcessingOptionsParams {
  target: KeyMemoryTarget | null;
  uniqueKeys: readonly (readonly string[])[];
  mapping: ReplaceColumnMapping;
  dbfFields: readonly string[];
}

export interface GeometryProcessingController {
  readonly options: GeometryProcessingOptions;
  readonly analyzedOptions: GeometryProcessingOptions | null;
  readonly suggestionOrigin: KeyOrigin;
  readonly isValid: boolean;
  readonly changedSinceAnalysis: boolean;
  readonly onChange: (next: GeometryProcessingOptions) => void;
  readonly omit: () => void;
  readonly prepareRun: (processing: GeometryProcessingOptions, dryRun: boolean) => void;
}

const signatureOf = (options: GeometryProcessingOptions): string => JSON.stringify(options);

const isUnifyKeyValid = (options: GeometryProcessingOptions, dbfFields: readonly string[]): boolean => {
  const dbfSet = new Set(dbfFields);
  return options.unify.keyFields.length > 0 && options.unify.keyFields.every((field) => dbfSet.has(field));
};

const withKeyFields = (options: GeometryProcessingOptions, keyFields: string[]): GeometryProcessingOptions => ({
  ...options,
  unify: { ...options.unify, keyFields },
});

export function useGeometryProcessingOptions({
  target,
  uniqueKeys,
  mapping,
  dbfFields,
}: UseGeometryProcessingOptionsParams): GeometryProcessingController {
  const [options, setOptions] = useState<GeometryProcessingOptions>(DEFAULT_GEOMETRY_PROCESSING);
  const [suggestionConsumed, setSuggestionConsumed] = useState(false);
  const [analyzedOptions, setAnalyzedOptions] = useState<GeometryProcessingOptions | null>(null);
  const [analyzedSignature, setAnalyzedSignature] = useState<string | null>(null);
  const [prunedAgainst, setPrunedAgainst] = useState(dbfFields);

  const memoryId = useMemo(() => (target ? buildKeyMemoryId(target) : null), [target]);
  const suggestion = useMemo(
    () =>
      suggestKeyFields({
        remembered: memoryId ? loadRememberedKey(getBrowserKeyStorage(), memoryId) : null,
        uniqueKeys,
        mapping,
        dbfFields,
      }),
    [memoryId, uniqueKeys, mapping, dbfFields]
  );

  if (prunedAgainst !== dbfFields) {
    setPrunedAgainst(dbfFields);
    setSuggestionConsumed(false);
    setOptions((previous) => withKeyFields(previous, pruneKeyFields(previous.unify.keyFields, dbfFields)));
  }

  const onChange = (next: GeometryProcessingOptions) => {
    const isFirstUnifyEnable = next.unify.enabled && !options.unify.enabled && !suggestionConsumed;
    if (!isFirstUnifyEnable) {
      setOptions(next);
      return;
    }
    setSuggestionConsumed(true);
    const applySuggestion = shouldApplySuggestion({
      consumed: suggestionConsumed,
      unifyEnabled: next.unify.enabled,
      keyFields: next.unify.keyFields,
      suggestion,
    });
    setOptions(applySuggestion ? withKeyFields(next, suggestion.fields) : next);
  };

  const prepareRun = (processing: GeometryProcessingOptions, dryRun: boolean) => {
    if (memoryId && processing.unify.enabled) {
      saveRememberedKey(getBrowserKeyStorage(), memoryId, processing.unify.keyFields);
    }
    setAnalyzedOptions(processing);
    if (dryRun) {
      setAnalyzedSignature(signatureOf(processing));
    }
  };

  return {
    options,
    analyzedOptions,
    suggestionOrigin: suggestion.origin,
    isValid: !options.unify.enabled || isUnifyKeyValid(options, dbfFields),
    changedSinceAnalysis: analyzedSignature !== null && analyzedSignature !== signatureOf(options),
    onChange,
    omit: () => setOptions(DEFAULT_GEOMETRY_PROCESSING),
    prepareRun,
  };
}
