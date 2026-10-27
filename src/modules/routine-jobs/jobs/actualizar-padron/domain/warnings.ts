import { sentence } from "../../cargar-padrones/domain/warnings";
import type { ActualizarTotals } from "../types";

export interface WarningInput {
  dryRun: boolean;
  totals: ActualizarTotals;
  collidingKeyCount: number;
  commitError: string | undefined;
}

const DRY_RUN_WARNING =
  "Simulación: la tabla de trabajo no fue modificada. La carga se revierte al final y el informe describe la carga simulada.";
const COMMIT_UNKNOWN_WARNING = "No se pudo confirmar el COMMIT: verifique la tabla de trabajo antes de reintentar.";

const plural = (count: number, singular: string, pluralForm: string): string =>
  `${count} ${count === 1 ? singular : pluralForm}`;

export function buildRunWarnings({ dryRun, totals, collidingKeyCount, commitError }: WarningInput): string[] {
  const warnings: string[] = [];
  if (dryRun) warnings.push(DRY_RUN_WARNING);
  if (totals.skipped > 0) {
    warnings.push(`${plural(totals.skipped, "fila omitida", "filas omitidas")} (ver los motivos en el informe).`);
  }
  if (totals.repaired > 0) {
    warnings.push(`${plural(totals.repaired, "geometría reparada", "geometrías reparadas")} con ST_MakeValid.`);
  }
  if (collidingKeyCount > 0) {
    warnings.push(
      `${plural(collidingKeyCount, "clave natural duplicada", "claves naturales duplicadas")}: se omitieron todas sus filas.`
    );
  }
  if (commitError !== undefined) {
    warnings.push(COMMIT_UNKNOWN_WARNING, `Error reportado al confirmar: ${sentence(commitError)}`);
  }
  return warnings;
}
