import { DETAIL_LIST_LIMIT } from "../../shared/limits";
import type { UnitOptions, UnitSourceTotals, UnitTargetReport } from "../types";
import { plural } from "../../shared/text";
import { addressMasterCountWarnings } from "../../shared/addressMasterLinkPass";
import { UNIT_SUBJECT_SPEC } from "../../shared/addressMasterLinkSpec";
import type { AddressMasterReport } from "../../shared/addressMasterLinkReport";

export interface UnitWarningInput {
  dryRun: boolean;
  options: UnitOptions;
  totals: UnitSourceTotals;
  target: UnitTargetReport;
  addressMaster?: AddressMasterReport;
  commitError?: string;
}

export const DRY_RUN_WARNING = "Análisis: la tabla de unidades territoriales no fue modificada.";
export const COMMIT_UNKNOWN_WARNING =
  "No se pudo confirmar el COMMIT: verifique la tabla de unidades territoriales antes de reintentar.";

function sourceWarnings({ skipped }: UnitSourceTotals): string[] {
  if (skipped === 0) return [];
  return [`${plural(skipped, "fila de origen omitida", "filas de origen omitidas")} (ver motivos en el informe).`];
}

function targetWarnings(target: UnitTargetReport, updateGeometries: boolean): string[] {
  const warnings: string[] = [];
  if (target.ambiguous > 0) {
    warnings.push(`${plural(target.ambiguous, "unidad ambigua", "unidades ambiguas")} en ${target.table}: no se insertaron ni actualizaron.`);
  }
  if (target.missing > 0) {
    warnings.push(`${plural(target.missing, "unidad", "unidades")} de ${target.table} sin fila de origen: se listan, no se modifican.`);
  }
  if (target.changed > 0 && !updateGeometries) {
    warnings.push(
      `${plural(target.changed, "geometría cambia", "geometrías cambian")} en ${target.table} y no se aplicó (Actualizar geometrías desactivado).`
    );
  }
  if (target.inserted > DETAIL_LIST_LIMIT) {
    warnings.push(`Se listan las primeras ${DETAIL_LIST_LIMIT} unidades insertadas en ${target.table}.`);
  }
  if (target.changed > DETAIL_LIST_LIMIT) {
    warnings.push(`Se listan las primeras ${DETAIL_LIST_LIMIT} geometrías que cambian en ${target.table}.`);
  }
  return warnings;
}

function addressMasterWarningsOf(target: UnitTargetReport, addressMaster: AddressMasterReport | undefined): string[] {
  return addressMaster === undefined ? [] : addressMasterCountWarnings(UNIT_SUBJECT_SPEC, target.table, addressMaster.counts);
}

export function buildUnitWarnings({ dryRun, options, totals, target, addressMaster, commitError }: UnitWarningInput): string[] {
  return [
    ...(dryRun ? [DRY_RUN_WARNING] : []),
    ...sourceWarnings(totals),
    ...targetWarnings(target, options.updateGeometries),
    ...addressMasterWarningsOf(target, addressMaster),
    ...(commitError === undefined ? [] : [COMMIT_UNKNOWN_WARNING]),
  ];
}
