import { PADRON_UNIT } from "../../cargar-padrones/constants";
import { literal } from "../../shared/sqlFragments";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import { DESTINATION_COLUMN } from "../constants";
import { physicalColumn, qualifiedName } from "./layouts";

const KEY_NUMBER_PATTERN = "^(0|[1-9][0-9]*)$";

const TEXT_TYPE_NAMES: ReadonlySet<string> = new Set(["text", "character varying", "character"]);
const TYPE_MODIFIER_SUFFIX = /\(.*\)$/;

export interface KeyFormatExample {
  id: number;
  typePadron: string | null;
  localityId: number | null;
  number: string | null;
}

export const isTextDataType = (dataType: string): boolean =>
  TEXT_TYPE_NAMES.has(dataType.replace(TYPE_MODIFIER_SUFFIX, "").trim());

function keyFormatViolationPredicates(target: WritableTargetLayout, numberIsText: boolean): string[] {
  const typePadron = physicalColumn(target, DESTINATION_COLUMN.TYPE_PADRON);
  const localityId = physicalColumn(target, DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY);
  const number = physicalColumn(target, DESTINATION_COLUMN.NUMBER);
  const rural = literal(PADRON_UNIT.RURAL);
  const urbano = literal(PADRON_UNIT.URBANO);
  return [
    `${typePadron} IS NULL OR ${typePadron} NOT IN (${rural}, ${urbano})`,
    `${typePadron} = ${rural} AND ${localityId} IS NOT NULL`,
    ...(numberIsText ? [`${number} IS NULL OR ${number} !~ ${literal(KEY_NUMBER_PATTERN)}`] : []),
  ];
}

export function buildKeyFormatSql(target: WritableTargetLayout, numberIsText: boolean): string {
  const id = physicalColumn(target, DESTINATION_COLUMN.ID);
  const violation = `(${keyFormatViolationPredicates(target, numberIsText)
    .map((predicate) => `(${predicate})`)
    .join(" OR ")})`;
  const example = [
    `json_build_object('id', ${id}`,
    `'typePadron', ${physicalColumn(target, DESTINATION_COLUMN.TYPE_PADRON)}`,
    `'localityId', ${physicalColumn(target, DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)}`,
    `'number', ${physicalColumn(target, DESTINATION_COLUMN.NUMBER)})`,
  ].join(", ");
  return [
    "SELECT",
    `count(*) FILTER (WHERE ${violation}) AS "bad",`,
    `(array_agg(${example} ORDER BY ${id}) FILTER (WHERE ${violation}))[1] AS "example"`,
    `FROM ${qualifiedName(target)}`,
  ].join(" ");
}

const shown = (value: unknown): string => (value === null || value === undefined ? "NULL" : JSON.stringify(value));

export function numberTypeIssue(label: string, column: string, dataType: string): string {
  return `La columna "${column}" de la tabla de destino ${label} es ${dataType}, no texto: la etapa compara los padrones por su número como texto.`;
}

export function keyFormatIssue(label: string, count: number, example: KeyFormatExample): string {
  const noun = count === 1 ? "fila" : "filas";
  return [
    `La tabla de destino ${label} tiene ${count} ${noun} con una clave que esta etapa no genera:`,
    "el tipo de padrón debe ser RURAL o URBANO, un padrón rural no debe tener localidad y el número debe ser 0 o un entero sin ceros a la izquierda.",
    `Por ejemplo, id ${shown(example.id)}: type_padron ${shown(example.typePadron)}, id_cadastral_locality ${shown(example.localityId)}, number ${shown(example.number)}.`,
    "No se escribió nada: corrija esas filas antes de cargar.",
  ].join(" ");
}
