import { useState } from "react";
import { deriveReplaceMapping, type ReplaceMappingEdits, type ReplaceMappingOptions } from "@/core/services/replaceMappingState";
import type { InsertFieldDefault } from "@/core/types/comparison";

interface MappingEdits extends ReplaceMappingEdits {
  signature: string;
}

const emptyEdits = (signature: string): MappingEdits => ({ signature, sourceByTarget: {}, defaults: {} });

export function useReplaceColumnMapping(
  sourceColumns: string[],
  targetColumns: string[],
  options?: ReplaceMappingOptions
) {
  const signature = `${sourceColumns.join("\u0000")}\u0001${targetColumns.join("\u0000")}`;
  const [edits, setEdits] = useState<MappingEdits>(() => emptyEdits(signature));
  const activeEdits = edits.signature === signature ? edits : emptyEdits(signature);
  const { mapping, autoMatches } = deriveReplaceMapping({ sourceColumns, targetColumns, edits: activeEdits, options });

  const setSource = (targetColumn: string, sourceColumn: string | null) =>
    setEdits({ ...activeEdits, sourceByTarget: { ...activeEdits.sourceByTarget, [targetColumn]: sourceColumn } });

  const setDefault = (targetColumn: string, fieldDefault: InsertFieldDefault) =>
    setEdits({ ...activeEdits, defaults: { ...activeEdits.defaults, [targetColumn]: fieldDefault } });

  return { mapping, autoMatches, setSource, setDefault };
}
