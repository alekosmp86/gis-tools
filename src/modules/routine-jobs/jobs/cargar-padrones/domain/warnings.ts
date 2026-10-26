import { AMBIGUOUS_LOCALITY_LIMIT, CONFLICT_SAMPLE_LIMIT, PADRON_UNIT, type PadronUnit } from "../constants";
import { UNIT_SPECS } from "./loadSql";
import type { LoadOutput, TypeReport } from "../types";

const UNIT_NAME: Record<PadronUnit, string> = {
  [PADRON_UNIT.RURAL]: "rural",
  [PADRON_UNIT.URBANO]: "urbano",
};

const COMMIT_UNKNOWN_WARNING =
  "No se pudo confirmar el COMMIT: verifique la tabla destino antes de reintentar.";

const plural = (count: number, singular: string, pluralForm: string): string =>
  `${count} ${count === 1 ? singular : pluralForm}`;

export const sentence = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`);

function keysTextOf(keys: readonly string[]): string {
  const leading = keys.slice(0, -1);
  const last = keys[keys.length - 1];
  return leading.length > 0 ? `${leading.join(", ")} o ${last}` : last;
}

function unitWarnings(unit: PadronUnit, report: TypeReport, repair: boolean): string[] {
  const name = UNIT_NAME[unit];
  const keys = keysTextOf(UNIT_SPECS[unit].keys);
  const warnings: string[] = [];
  if (report.nullKeyRows > 0) {
    warnings.push(`${plural(report.nullKeyRows, "fila", "filas")} ${name} con clave nula (${keys}) se excluyeron de la carga.`);
  }
  if (report.noGeometry > 0) {
    warnings.push(`${plural(report.noGeometry, "fila", "filas")} ${name} sin geometría utilizable se excluyeron de la carga.`);
  }
  if (report.attributeConflicts > 0) {
    warnings.push(
      `${plural(report.attributeConflicts, "grupo", "grupos")} ${name} con atributos en conflicto. La carga no se bloquea; se listan hasta ${CONFLICT_SAMPLE_LIMIT} ejemplos.`
    );
  }
  if (!repair && report.insertedInvalid > 0) {
    warnings.push(
      `${plural(report.insertedInvalid, "geometría inválida se insertó", "geometrías inválidas se insertaron")} sin reparar en ${name}: la tabla destino contiene geometrías inválidas.`
    );
  }
  if (!repair && report.repairedInUnion > 0) {
    warnings.push(
      `${plural(report.repairedInUnion, "grupo", "grupos")} ${name} con geometría inválida se repararon dentro de la unión (ST_MakeValid).`
    );
  }
  return warnings;
}

export function buildWarnings(loaded: LoadOutput, repair: boolean, commitError: string | undefined): string[] {
  const warnings = [
    ...unitWarnings(PADRON_UNIT.RURAL, loaded.rural, repair),
    ...unitWarnings(PADRON_UNIT.URBANO, loaded.urbano, repair),
  ];
  if (loaded.ambiguousLocalityCodes.length > 0) {
    warnings.push(
      `${plural(loaded.ambiguousLocalityCodes.length, "par", "pares")} (coddepto, codloccat) con más de un nombre de localidad (hasta ${AMBIGUOUS_LOCALITY_LIMIT}). La carga no se bloquea.`
    );
  }
  if (commitError !== undefined) {
    warnings.push(COMMIT_UNKNOWN_WARNING, `Error reportado al confirmar: ${sentence(commitError)}`);
  }
  return warnings;
}
