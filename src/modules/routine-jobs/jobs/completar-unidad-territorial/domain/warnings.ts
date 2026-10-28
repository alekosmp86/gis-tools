import { DETAIL_LIST_LIMIT } from "../../shared/limits";
import type { CompletarCounts } from "../types";
import { plural } from "../../shared/text";

export interface CompletarWarningInput {
  dryRun: boolean;
  unitTable: string;
  counts: CompletarCounts;
  commitError?: string;
}

export const DRY_RUN_WARNING = "Análisis: las tablas de unidades territoriales y de direcciones maestras no fueron modificadas.";
export const COMMIT_UNKNOWN_WARNING =
  "No se pudo confirmar el COMMIT: verifique las tablas de unidades territoriales y de direcciones maestras antes de reintentar.";

function countWarnings({ unitTable, counts }: CompletarWarningInput): string[] {
  const warnings: string[] = [];
  if (counts.ambiguous > 0) {
    warnings.push(
      `${plural(counts.ambiguous, "unidad ambigua", "unidades ambiguas")} en ${unitTable}: tienen más de un registro de dirección maestra con su URN, no se crearon ni enlazaron.`
    );
  }
  if (counts.linked > DETAIL_LIST_LIMIT) {
    warnings.push(`Se listan las primeras ${DETAIL_LIST_LIMIT} unidades enlazadas en ${unitTable}.`);
  }
  return warnings;
}

export function buildCompletarWarnings(input: CompletarWarningInput): string[] {
  return [
    ...(input.dryRun ? [DRY_RUN_WARNING] : []),
    ...countWarnings(input),
    ...(input.commitError === undefined ? [] : [COMMIT_UNKNOWN_WARNING]),
  ];
}
