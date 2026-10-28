import { DETAIL_LIST_LIMIT } from "../../shared/limits";
import type { SourceTotals, TargetReport } from "../types";
import { plural } from "../../shared/text";

export interface WarningInput {
  dryRun: boolean;
  updateGeometries: boolean;
  totals: SourceTotals;
  targets: readonly TargetReport[];
  commitError?: string;
}

export const DRY_RUN_WARNING = "Análisis: las tablas de localidades no fueron modificadas.";
export const COMMIT_UNKNOWN_WARNING = "No se pudo confirmar el COMMIT: verifique las tablas de localidades antes de reintentar.";

function sourceWarnings({ skipped, repaired }: SourceTotals): string[] {
  const warnings: string[] = [];
  if (skipped > 0) {
    warnings.push(`${plural(skipped, "fila de origen omitida", "filas de origen omitidas")} (ver motivos en el informe).`);
  }
  if (repaired > 0) {
    warnings.push(`${plural(repaired, "geometría de origen reparada", "geometrías de origen reparadas")} con ST_MakeValid.`);
  }
  return warnings;
}

function targetWarnings(target: TargetReport, updateGeometries: boolean): string[] {
  const warnings: string[] = [];
  if (target.ambiguous > 0) {
    warnings.push(
      `${plural(target.ambiguous, "localidad ambigua", "localidades ambiguas")} en ${target.table}: no se insertaron ni actualizaron.`
    );
  }
  if (target.missing > 0) {
    warnings.push(
      `${plural(target.missing, "localidad", "localidades")} de ${target.table} sin fila de origen: se listan, no se eliminan.`
    );
  }
  if (target.changed > 0 && !updateGeometries) {
    warnings.push(
      `${plural(target.changed, "geometría cambia", "geometrías cambian")} en ${target.table} y no se aplicó (Actualizar geometrías desactivado).`
    );
  }
  if (target.inserted > DETAIL_LIST_LIMIT) {
    warnings.push(`Se listan las primeras ${DETAIL_LIST_LIMIT} localidades insertadas en ${target.table}.`);
  }
  if (target.changed > DETAIL_LIST_LIMIT) {
    warnings.push(`Se listan las primeras ${DETAIL_LIST_LIMIT} geometrías que cambian en ${target.table}.`);
  }
  return warnings;
}

export function buildWarnings({ dryRun, updateGeometries, totals, targets, commitError }: WarningInput): string[] {
  return [
    ...(dryRun ? [DRY_RUN_WARNING] : []),
    ...sourceWarnings(totals),
    ...targets.flatMap((target) => targetWarnings(target, updateGeometries)),
    ...(commitError === undefined ? [] : [COMMIT_UNKNOWN_WARNING]),
  ];
}
