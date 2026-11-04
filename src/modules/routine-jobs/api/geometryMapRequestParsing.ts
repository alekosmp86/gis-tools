import { GEOMETRY_MAP_ITEMS_LIMIT } from "../jobs/actualizar-padron/domain/geometryMap";
import type { GeometryMapItem, GeometryMapStagingKey } from "../jobs/actualizar-padron/types";
import type { GeometryMapParams } from "../jobs/actualizar-padron/services/readGeometryMap";
import { PADRON_UNIT } from "../jobs/cargar-padrones/constants";
import { invalid, isRecord, parseConnection, readRequiredText, toDbConfig, type JsonRecord } from "./requestParsing";

const MAP_ITEMS_MESSAGE = `El campo items debe ser una lista de 1 a ${GEOMETRY_MAP_ITEMS_LIMIT} elementos.`;
const MAP_ITEM_MESSAGE = "Cada elemento de items necesita oldId o staging.";
const MAP_TYPE_VALUES: readonly string[] = [PADRON_UNIT.RURAL, PADRON_UNIT.URBANO];
const DIGITS_PATTERN = /^\d+$/;
const INT4_MIN = -2147483648;
const INT4_MAX = 2147483647;

function readOptionalOldId(item: JsonRecord): number | undefined {
  const value = item.oldId;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < INT4_MIN || value > INT4_MAX) {
    throw invalid("El campo items.oldId debe ser un entero.");
  }
  return value;
}

function readOptionalText(record: JsonRecord, key: string): string | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw invalid(`El campo ${key} debe ser texto.`);
  return value.trim() === "" ? null : value.trim();
}

function readStagingKey(record: JsonRecord): GeometryMapStagingKey {
  const typePadron = readRequiredText(record, "typePadron").trim();
  if (!MAP_TYPE_VALUES.includes(typePadron)) throw invalid(`El campo typePadron debe ser ${PADRON_UNIT.RURAL} o ${PADRON_UNIT.URBANO}.`);
  const locality = readOptionalText(record, "locality");
  if (typePadron === PADRON_UNIT.URBANO && locality === null) throw invalid("Indique la localidad de un padrón urbano.");
  const number = readRequiredText(record, "number").trim();
  if (!DIGITS_PATTERN.test(number)) throw invalid("El número de padrón debe ser un número entero.");
  return {
    typePadron,
    department: readRequiredText(record, "department").trim(),
    locality: typePadron === PADRON_UNIT.URBANO ? locality : null,
    number,
  };
}

function readMapItem(entry: unknown): GeometryMapItem {
  if (!isRecord(entry)) throw invalid("Cada elemento de items debe ser un objeto.");
  const oldId = readOptionalOldId(entry);
  if (entry.staging !== undefined && entry.staging !== null && !isRecord(entry.staging)) {
    throw invalid("El campo items.staging debe ser un objeto.");
  }
  const staging = isRecord(entry.staging) ? readStagingKey(entry.staging) : undefined;
  if (oldId === undefined && staging === undefined) throw invalid(MAP_ITEM_MESSAGE);
  return { ...(oldId === undefined ? {} : { oldId }), ...(staging === undefined ? {} : { staging }) };
}

function readMapItems(body: JsonRecord): GeometryMapItem[] {
  const value = body.items;
  if (!Array.isArray(value) || value.length === 0 || value.length > GEOMETRY_MAP_ITEMS_LIMIT) throw invalid(MAP_ITEMS_MESSAGE);
  return value.map(readMapItem);
}

/** The map request: the connection and the staging and destination tables of the start request; the map reads no other table. */
export function parseGeometryMapRequest(body: JsonRecord): GeometryMapParams {
  return {
    config: toDbConfig(parseConnection(body)),
    stagingSchema: readRequiredText(body, "stagingSchema"),
    stagingTable: readRequiredText(body, "stagingTable"),
    cartoSchema: readRequiredText(body, "cartoSchema"),
    targetTable: readRequiredText(body, "targetTable"),
    items: readMapItems(body),
  };
}
