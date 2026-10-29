import { sentence } from "../../cargar-padrones/domain/warnings";
import { addressMasterCountWarnings } from "../../shared/addressMasterLinkPass";
import { PADRON_SUBJECT_SPEC } from "../../shared/addressMasterLinkSpec";
import { DETAIL_LIST_LIMIT } from "../../shared/limits";
import { plural } from "../../shared/text";
import type { ActualizarAddressMasterReport, ActualizarPadronOptions, ActualizarTargetReport, ActualizarTotals } from "../types";

export interface WarningInput {
  dryRun: boolean;
  options: ActualizarPadronOptions;
  totals: ActualizarTotals;
  target: ActualizarTargetReport;
  addressMaster?: ActualizarAddressMasterReport;
  collidingKeyCount: number;
  commitError: string | undefined;
}

export const DRY_RUN_WARNING = "Análisis: la tabla de destino no fue modificada. Todo se revierte al final y el informe describe lo que cambiaría.";
export const COMMIT_UNKNOWN_WARNING = "No se pudo confirmar el COMMIT: verifique las tablas de destino antes de reintentar.";

function totalsWarnings({ skipped, repaired }: ActualizarTotals, collidingKeyCount: number): string[] {
  const warnings: string[] = [];
  if (skipped > 0) warnings.push(`${plural(skipped, "fila omitida", "filas omitidas")} (ver los motivos en el informe).`);
  if (repaired > 0) warnings.push(`${plural(repaired, "geometría reparada", "geometrías reparadas")} con ST_MakeValid.`);
  if (collidingKeyCount > 0) {
    warnings.push(`${plural(collidingKeyCount, "clave natural duplicada", "claves naturales duplicadas")}: se omitieron todas sus filas.`);
  }
  return warnings;
}

function targetWarnings(target: ActualizarTargetReport, updateGeometries: boolean): string[] {
  const warnings: string[] = [];
  if (target.ambiguous > 0) {
    warnings.push(`${plural(target.ambiguous, "padrón ambiguo", "padrones ambiguos")} en ${target.table}: no se insertaron ni actualizaron.`);
  }
  if (target.missing > 0) {
    warnings.push(`${plural(target.missing, "padrón", "padrones")} de ${target.table} sin fila de origen: se listan, no se modifican.`);
  }
  if (target.changed > 0 && !updateGeometries) {
    warnings.push(
      `${plural(target.changed, "geometría cambia", "geometrías cambian")} en ${target.table} y no se aplicó (Actualizar geometrías desactivado).`
    );
  }
  if (target.inserted > DETAIL_LIST_LIMIT) {
    warnings.push(`Se listan las primeras ${DETAIL_LIST_LIMIT} filas insertadas en ${target.table}.`);
  }
  if (target.changed > DETAIL_LIST_LIMIT) {
    warnings.push(`Se listan las primeras ${DETAIL_LIST_LIMIT} geometrías que cambian en ${target.table}.`);
  }
  return warnings;
}

function addressMasterWarningsOf(target: ActualizarTargetReport, addressMaster: ActualizarAddressMasterReport | undefined): string[] {
  return addressMaster === undefined ? [] : addressMasterCountWarnings(PADRON_SUBJECT_SPEC, target.table, addressMaster.counts);
}

export function buildRunWarnings({ dryRun, options, totals, target, addressMaster, collidingKeyCount, commitError }: WarningInput): string[] {
  return [
    ...(dryRun ? [DRY_RUN_WARNING] : []),
    ...totalsWarnings(totals, collidingKeyCount),
    ...targetWarnings(target, options.updateGeometries),
    ...addressMasterWarningsOf(target, addressMaster),
    ...(commitError === undefined ? [] : [COMMIT_UNKNOWN_WARNING, `Error reportado al confirmar: ${sentence(commitError)}`]),
  ];
}
