import { plural } from "../../shared/text";
import type { EjesStagingReport, EjesUnknownValue } from "../types";

const valuesTextOf = (values: readonly EjesUnknownValue[]): string =>
  values.map((entry) => `${entry.value ?? "sin dato"} (${plural(entry.rows, "fila", "filas")})`).join(", ");

export function ejesBlockersOf(staging: EjesStagingReport): string[] {
  const blockers: string[] = [];
  if (staging.repeatedGroups > 0) {
    blockers.push(
      `${plural(staging.repeatedGroups, "reftramo se repite", "reftramo se repiten")} (${plural(staging.repeatedRows, "fila", "filas")}).`
    );
  }
  if (staging.nonIntegerRefs > 0) {
    blockers.push(`${plural(staging.nonIntegerRefs, "fila tiene", "filas tienen")} un reftramo que no es un entero.`);
  }
  if (staging.emptyGeometry > 0) {
    blockers.push(`${plural(staging.emptyGeometry, "fila tiene", "filas tienen")} la geometría nula o vacía.`);
  }
  if (staging.emptyIdcalle > 0) {
    blockers.push(`${plural(staging.emptyIdcalle, "fila tiene", "filas tienen")} el idcalle vacío.`);
  }
  if (staging.damagedTextRows > 0) {
    blockers.push(
      `Hay ${staging.damagedTextRows} filas con caracteres dañados (�) en nombre, localidad o departamento. Corrija la codificación y vuelva a cargar.`
    );
  }
  if (staging.unknownTipoRows > 0) {
    blockers.push(`Tipo de vialidad fuera de la tabla de tipos: ${valuesTextOf(staging.unknownTipos)}.`);
  }
  if (staging.unknownFuenteRows > 0) {
    blockers.push(`Fuente fuera de la tabla de fuentes: ${valuesTextOf(staging.unknownFuentes)}.`);
  }
  return blockers;
}
