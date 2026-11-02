import { PADRON_UNIT } from "../jobs/cargar-padrones/constants";
import { pairChoiceKeyId } from "../jobs/actualizar-padron/domain/pairChoiceKey";
import type { AcceptedGeometry, PairChoice } from "../jobs/actualizar-padron/types";
import { PAIR_LIST_LIMIT } from "../jobs/shared/limits";
import { invalid, isRecord, type JsonRecord } from "./requestParsing";

const PAIR_FIELD = "pairChoices";
const ACCEPT_FIELD = "acceptedGeometries";
const INT4_MIN = -2147483648;
const INT4_MAX = 2147483647;
const TYPE_PADRON_VALUES: readonly string[] = [PADRON_UNIT.RURAL, PADRON_UNIT.URBANO];

const isInt4 = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= INT4_MIN && value <= INT4_MAX;

const isFilledText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

function readIntegerField(field: string, entry: JsonRecord, key: string): number {
  const value = entry[key];
  if (!isInt4(value)) throw invalid(`El campo ${field}.${key} debe ser un entero entre ${INT4_MIN} y ${INT4_MAX}.`);
  return value;
}

function readNullableIntegerField(field: string, entry: JsonRecord, key: string): number | null {
  return entry[key] === null ? null : readIntegerField(field, entry, key);
}

function readTextField(field: string, entry: JsonRecord, key: string): string {
  const value = entry[key];
  if (!isFilledText(value)) throw invalid(`El campo ${field}.${key} es obligatorio y debe ser texto.`);
  return value;
}

function readTypePadronField(field: string, entry: JsonRecord): string {
  const value = readTextField(field, entry, "typePadron");
  if (!TYPE_PADRON_VALUES.includes(value)) throw invalid(`El campo ${field}.typePadron debe ser ${PADRON_UNIT.RURAL} o ${PADRON_UNIT.URBANO}.`);
  return value;
}

/** The new padrón key shared by a pair choice and an accepted geometry. */
function readNewKey(field: string, entry: JsonRecord): AcceptedGeometry {
  return {
    typePadron: readTypePadronField(field, entry),
    provinceId: readIntegerField(field, entry, "provinceId"),
    localityId: readNullableIntegerField(field, entry, "localityId"),
    number: readTextField(field, entry, "number"),
  };
}

function readChoice(value: unknown): PairChoice {
  if (!isRecord(value)) throw invalid(`Cada elección de ${PAIR_FIELD} debe ser un objeto.`);
  return { ...readNewKey(PAIR_FIELD, value), oldId: readNullableIntegerField(PAIR_FIELD, value, "oldId") };
}

function readAccept(value: unknown): AcceptedGeometry {
  if (!isRecord(value)) throw invalid(`Cada elemento de ${ACCEPT_FIELD} debe ser un objeto.`);
  return readNewKey(ACCEPT_FIELD, value);
}

function assertOneChoicePerNewKey(choices: readonly PairChoice[]): void {
  const newKeys = new Set(choices.map(pairChoiceKeyId));
  if (newKeys.size !== choices.length) throw invalid(`${PAIR_FIELD} tiene dos elecciones para el mismo padrón nuevo.`);
}

function assertOneNewKeyPerOldId(choices: readonly PairChoice[]): void {
  const chosenOldIds = choices.flatMap((choice) => (choice.oldId === null ? [] : [choice.oldId]));
  if (new Set(chosenOldIds).size !== chosenOldIds.length) {
    throw invalid(`${PAIR_FIELD} elige el mismo padrón de destino para dos padrones nuevos.`);
  }
}

/** Absent means an empty list; anything else must be a list within the limit. The list is rejected, never truncated. */
function readBoundedList(options: JsonRecord, field: string, noun: string): unknown[] {
  const value = options[field];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalid(`El campo ${field} debe ser una lista.`);
  if (value.length > PAIR_LIST_LIMIT) throw invalid(`El campo ${field} admite como máximo ${PAIR_LIST_LIMIT} ${noun}.`);
  return value;
}

/** Absent means no choices; a choice with a null oldId means "insert as new", so it may repeat. */
export function readPairChoices(options: JsonRecord): PairChoice[] {
  const choices = readBoundedList(options, PAIR_FIELD, "elecciones").map(readChoice);
  assertOneChoicePerNewKey(choices);
  assertOneNewKeyPerOldId(choices);
  return choices;
}

/** Absent means none (AP-100): each entry is the key of a pending geometry change, once. */
export function readAcceptedGeometries(options: JsonRecord): AcceptedGeometry[] {
  const accepts = readBoundedList(options, ACCEPT_FIELD, "geometrías aceptadas").map(readAccept);
  if (new Set(accepts.map(pairChoiceKeyId)).size !== accepts.length) {
    throw invalid(`${ACCEPT_FIELD} acepta dos veces el mismo padrón.`);
  }
  return accepts;
}
