import { addressMasterCountWarnings } from "../../shared/addressMasterLinkPass";
import { UNIT_SUBJECT_SPEC } from "../../shared/addressMasterLinkSpec";
import type { CompletarCounts } from "../types";

export interface CompletarWarningInput {
  dryRun: boolean;
  unitTable: string;
  counts: CompletarCounts;
  commitError?: string;
}

export const DRY_RUN_WARNING = "Análisis: las tablas de unidades territoriales y de direcciones maestras no fueron modificadas.";
export const COMMIT_UNKNOWN_WARNING =
  "No se pudo confirmar el COMMIT: verifique las tablas de unidades territoriales y de direcciones maestras antes de reintentar.";

export function buildCompletarWarnings(input: CompletarWarningInput): string[] {
  return [
    ...(input.dryRun ? [DRY_RUN_WARNING] : []),
    ...addressMasterCountWarnings(UNIT_SUBJECT_SPEC, input.unitTable, input.counts),
    ...(input.commitError === undefined ? [] : [COMMIT_UNKNOWN_WARNING]),
  ];
}
