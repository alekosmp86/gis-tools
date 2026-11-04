import { sentence } from "../../cargar-padrones/domain/warnings";
import { addressMasterCountWarnings } from "../../shared/addressMasterLinkPass";
import { PADRON_SUBJECT_SPEC } from "../../shared/addressMasterLinkSpec";
import { DETAIL_LIST_LIMIT } from "../../shared/limits";
import { plural } from "../../shared/text";
import { PAIR_LOOSE_OVERLAP_MIN, PAIR_OVERLAP_MIN, REMOVAL_SKIP_REASON } from "../constants";
import type {
  ActualizarAddressMasterReport,
  ActualizarPadronOptions,
  ActualizarTargetReport,
  ActualizarTotals,
  RemovalSkippedReport,
} from "../types";

export interface WarningInput {
  dryRun: boolean;
  options: ActualizarPadronOptions;
  totals: ActualizarTotals;
  target: ActualizarTargetReport;
  addressMaster?: ActualizarAddressMasterReport;
  collidingKeyCount: number;
  localityWarnings: string[];
  commitError: string | undefined;
}

export const DRY_RUN_WARNING =
  "Análisis de solo lectura: la tabla de destino no fue modificada y el informe describe lo que cambiaría. Para guardar, ejecute la actualización desde este análisis.";
const ADDRESS_MASTER_PLAN_WARNING =
  "Las direcciones maestras se cuentan sobre los padrones que ya están en el destino: las de los padrones nuevos se calculan al guardar.";
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

const PERCENT_SCALE = 100;
const LOOSE_OVERLAP_RANGE = `${Math.round(PAIR_LOOSE_OVERLAP_MIN * PERCENT_SCALE)}-${Math.round(PAIR_OVERLAP_MIN * PERCENT_SCALE)}%`;

const looseWarningOf = (pairsLoose: number): string => {
  const pronoun = pairsLoose === 1 ? "lo" : "los";
  return `${plural(pairsLoose, "padrón se actualiza", "padrones se actualizan")} por coincidencia parcial (superposición ${LOOSE_OVERLAP_RANGE}); revisar${pronoun} en el listado de pares.`;
};

const choicesUnappliedWarningOf = (choicesUnapplied: number): string =>
  `${plural(choicesUnapplied, "elección de par no se aplicó", "elecciones de par no se aplicaron")} (el padrón elegido ya no es candidato o sigue siendo ambiguo).`;

function pairWarnings(target: ActualizarTargetReport): string[] {
  const warnings: string[] = [];
  if (target.pairsApplied > 0) {
    warnings.push(
      `${plural(target.pairsApplied, "padrón se actualiza", "padrones se actualizan")} en su clave (tipo, localidad o número) en ${target.table} en lugar de insertarse como nuevos.`
    );
  }
  if (target.pairsLoose > 0) warnings.push(looseWarningOf(target.pairsLoose));
  if (target.pairsPending > 0) {
    warnings.push(
      `${plural(target.pairsPending, "posible par de coincidencia parcial está pendiente", "posibles pares de coincidencia parcial están pendientes")}: se insertan como nuevos y la fila antigua se lista como faltante.`
    );
  }
  if (target.pairsNotApplied > 0) {
    warnings.push(
      `${plural(target.pairsNotApplied, "posible par no se aplicó", "posibles pares no se aplicaron")} (ambiguos): se insertan como nuevos y la fila antigua se lista como faltante.`
    );
  }
  if (target.choicesUnapplied > 0) warnings.push(choicesUnappliedWarningOf(target.choicesUnapplied));
  return warnings;
}

const geometryAcceptsUnappliedWarningOf = (count: number): string =>
  `${plural(count, "geometría aceptada no se aplicó", "geometrías aceptadas no se aplicaron")} (el padrón ya no tiene un cambio de geometría o Actualizar geometrías está desactivado).`;

const removalDoneWarningOf = (removed: number, table: string, dryRun: boolean): string =>
  dryRun
    ? `${plural(removed, "padrón sin fila de origen se eliminará", "padrones sin fila de origen se eliminarán")} de ${table} (sin direcciones asociadas o con direcciones reasignadas a sus partes).`
    : `${plural(removed, "padrón sin fila de origen eliminado", "padrones sin fila de origen eliminados")} de ${table} (sin direcciones asociadas o con direcciones reasignadas a sus partes).`;

const removalSkippedWarningOf = (removalsSkipped: RemovalSkippedReport): string => {
  const paired = removalsSkipped.byReason[REMOVAL_SKIP_REASON.STILL_PAIRABLE];
  const referenced = removalsSkipped.byReason[REMOVAL_SKIP_REASON.NOW_REFERENCED];
  const notReassignable = removalsSkipped.byReason[REMOVAL_SKIP_REASON.NOT_REASSIGNABLE];
  const reasons = [
    ...(paired > 0 ? [`${paired} porque tienen un par sin resolver`] : []),
    ...(referenced > 0 ? [`${referenced} porque tienen direcciones asociadas`] : []),
    ...(notReassignable > 0 ? [`${notReassignable} porque no se pueden reasignar sus direcciones`] : []),
  ];
  return `${plural(paired + referenced + notReassignable, "padrón sin fila de origen no se elimina", "padrones sin fila de origen no se eliminan")}: ${reasons.join(", ")}.`;
};

const notDeletedCountOf = (removalsSkipped: RemovalSkippedReport): number =>
  removalsSkipped.byReason[REMOVAL_SKIP_REASON.STILL_PAIRABLE] +
  removalsSkipped.byReason[REMOVAL_SKIP_REASON.NOW_REFERENCED] +
  removalsSkipped.byReason[REMOVAL_SKIP_REASON.NOT_REASSIGNABLE];

const reassignedWarningOf = (reassigned: number, dryRun: boolean): string =>
  dryRun
    ? `${plural(reassigned, "dirección de un padrón subdividido pasará", "direcciones de padrones subdivididos pasarán")} a la parte más cercana.`
    : `${plural(reassigned, "dirección de un padrón subdividido pasó", "direcciones de padrones subdivididos pasaron")} a la parte más cercana.`;

const reassignedChangedWarningOf = (changed: number, dryRun: boolean): string =>
  dryRun
    ? `${plural(changed, "dirección cambiará", "direcciones cambiarán")} de padrón (id_padron) porque su padrón cambió de forma.`
    : `${plural(changed, "dirección cambió", "direcciones cambiaron")} de padrón (id_padron) porque su padrón cambió de forma.`;

function removalWarnings(target: ActualizarTargetReport, dryRun: boolean): string[] {
  const warnings: string[] = [];
  if (target.removalBlockedReason !== undefined) warnings.push(target.removalBlockedReason);
  if ((target.removed ?? 0) > 0) warnings.push(removalDoneWarningOf(target.removed ?? 0, target.table, dryRun));
  if ((target.reassigned ?? 0) > 0) warnings.push(reassignedWarningOf(target.reassigned ?? 0, dryRun));
  if ((target.reassignedChanged ?? 0) > 0) warnings.push(reassignedChangedWarningOf(target.reassignedChanged ?? 0, dryRun));
  if (target.removalsSkipped !== undefined && notDeletedCountOf(target.removalsSkipped) > 0) {
    warnings.push(removalSkippedWarningOf(target.removalsSkipped));
  }
  return warnings;
}

const geometryThresholdPercentOf =(fraction: number): string => String(Number((fraction * PERCENT_SCALE).toFixed(1)));

function targetWarnings(target: ActualizarTargetReport, options: ActualizarPadronOptions, dryRun: boolean): string[] {
  const warnings: string[] = [];
  if (target.ambiguous > 0) {
    warnings.push(`${plural(target.ambiguous, "padrón ambiguo", "padrones ambiguos")} en ${target.table}: no se insertaron ni actualizaron.`);
  }
  const keptMissing = target.missing - (target.removed ?? 0);
  if (keptMissing > 0) {
    warnings.push(`${plural(keptMissing, "padrón", "padrones")} de ${target.table} sin fila de origen: se listan, no se modifican.`);
  }
  if (target.changed > 0 && !options.updateGeometries) {
    warnings.push(
      `${plural(target.changed, "geometría cambia", "geometrías cambian")} en ${target.table} y no se aplicó (Actualizar geometrías desactivado).`
    );
  }
  if (target.geometryPending > 0 && options.updateGeometries) {
    warnings.push(
      `${plural(target.geometryPending, "geometría cambia", "geometrías cambian")} en ${target.table} con un cambio de área igual o superior al ${geometryThresholdPercentOf(options.geometryAreaThreshold)} %: quedó pendiente y no se aplicó.`
    );
  }
  const acceptsUnapplied = target.geometryAcceptsUnapplied ?? 0;
  if (acceptsUnapplied > 0) warnings.push(geometryAcceptsUnappliedWarningOf(acceptsUnapplied));
  warnings.push(...removalWarnings(target, dryRun));
  warnings.push(...pairWarnings(target));
  if (!dryRun && target.inserted > DETAIL_LIST_LIMIT) {
    warnings.push(`Se listan las primeras ${DETAIL_LIST_LIMIT} filas insertadas en ${target.table}.`);
  }
  if (target.changed > DETAIL_LIST_LIMIT) {
    warnings.push(`Se listan las primeras ${DETAIL_LIST_LIMIT} geometrías que cambian en ${target.table}.`);
  }
  return warnings;
}

/** An analysis carries no linked list, so its planned count does not announce a listing. */
function addressMasterWarningsOf(
  target: ActualizarTargetReport,
  addressMaster: ActualizarAddressMasterReport | undefined,
  dryRun: boolean
): string[] {
  if (addressMaster === undefined) return [];
  const { ambiguous, linked } = addressMaster.counts;
  return addressMasterCountWarnings(PADRON_SUBJECT_SPEC, target.table, { ambiguous, linked: dryRun ? 0 : linked });
}

export function buildRunWarnings({
  dryRun,
  options,
  totals,
  target,
  addressMaster,
  collidingKeyCount,
  localityWarnings,
  commitError,
}: WarningInput): string[] {
  return [
    ...(dryRun ? [DRY_RUN_WARNING] : []),
    ...(dryRun && addressMaster !== undefined ? [ADDRESS_MASTER_PLAN_WARNING] : []),
    ...localityWarnings,
    ...totalsWarnings(totals, collidingKeyCount),
    ...targetWarnings(target, options, dryRun),
    ...addressMasterWarningsOf(target, addressMaster, dryRun),
    ...(commitError === undefined ? [] : [COMMIT_UNKNOWN_WARNING, `Error reportado al confirmar: ${sentence(commitError)}`]),
  ];
}
