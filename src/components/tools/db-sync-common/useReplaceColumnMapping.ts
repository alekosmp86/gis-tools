import { useState } from "react";
import { buildDefaultColumnMapping, type ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import type { InsertFieldDefault } from "@/core/types/comparison";

interface MappingEdits {
  signature: string;
  sourceByTarget: Record<string, string | null>;
  defaults: Record<string, InsertFieldDefault>;
}

export function useReplaceColumnMapping(sourceColumns: string[], targetColumns: string[]) {
  const signature = `${sourceColumns.join("\u0000")}\u0001${targetColumns.join("\u0000")}`;
  const [edits, setEdits] = useState<MappingEdits>({ signature, sourceByTarget: {}, defaults: {} });
  const activeEdits = edits.signature === signature ? edits : { signature, sourceByTarget: {}, defaults: {} };

  const base = buildDefaultColumnMapping(sourceColumns, targetColumns);
  const mapping: ReplaceColumnMapping = {
    sourceByTarget: { ...base.sourceByTarget, ...activeEdits.sourceByTarget },
    defaults: activeEdits.defaults,
  };

  const setSource = (targetColumn: string, sourceColumn: string | null) =>
    setEdits({ ...activeEdits, sourceByTarget: { ...activeEdits.sourceByTarget, [targetColumn]: sourceColumn } });

  const setDefault = (targetColumn: string, fieldDefault: InsertFieldDefault) =>
    setEdits({ ...activeEdits, defaults: { ...activeEdits.defaults, [targetColumn]: fieldDefault } });

  return { mapping, setSource, setDefault };
}
