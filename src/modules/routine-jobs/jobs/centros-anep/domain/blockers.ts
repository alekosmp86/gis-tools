import { plural } from "../../shared/text";
import type { CentrosStagingReport } from "../types";

export const EMPTY_STAGING_BLOCKER = "La tabla de staging no tiene filas: no hay centros ANEP para cargar.";

export function stagingBlockersOf(staging: CentrosStagingReport): string[] {
  const blockers: string[] = [];
  if (staging.rows === 0) blockers.push(EMPTY_STAGING_BLOCKER);
  if (staging.emptyGeometry > 0) {
    blockers.push(`${plural(staging.emptyGeometry, "fila tiene", "filas tienen")} la geometría nula o vacía.`);
  }
  if (staging.unsupportedSridRows > 0) {
    blockers.push(
      `${plural(staging.unsupportedSridRows, "fila tiene", "filas tienen")} una geometría con SRID 0 o desconocido: no se puede transformar al SRID de la tabla final.`
    );
  }
  if (staging.damagedTextRows > 0) {
    blockers.push(
      `Hay ${plural(staging.damagedTextRows, "fila", "filas")} con caracteres dañados (�) en las columnas de texto. Corrija la codificación y vuelva a cargar el staging.`
    );
  }
  return blockers;
}

export function stagingWarningsOf(staging: CentrosStagingReport): string[] {
  const warnings: string[] = [];
  if (staging.repeatedGroups > 0) {
    warnings.push(
      `${plural(staging.repeatedGroups, "ruee se repite", "ruee se repiten")} (${plural(staging.repeatedRows, "fila", "filas")}): la fuente tiene ruee repetidos y se cargan todos.`
    );
  }
  if (staging.nullRuee > 0) {
    warnings.push(`${plural(staging.nullRuee, "fila tiene", "filas tienen")} el ruee nulo.`);
  }
  if (staging.nullSubsistema > 0) {
    warnings.push(`${plural(staging.nullSubsistema, "fila tiene", "filas tienen")} el subsistema nulo: no se dibuja con icono.`);
  }
  return warnings;
}
