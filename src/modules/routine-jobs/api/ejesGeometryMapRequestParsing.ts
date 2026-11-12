import { EJES_TABLE_ROLE, PADRON_TYPE, type PadronType } from "../jobs/ejes-calles/constants";
import { EJES_MAP_ITEMS_LIMIT } from "../jobs/ejes-calles/domain/geometryMap";
import type { EjesGeometryMapParams, EjesMapItem, EjesTableRef } from "../jobs/ejes-calles/types";
import { invalid, isRecord, parseConnection, readRecord, readRequiredText, toDbConfig, type JsonRecord } from "./requestParsing";

const MAP_ITEMS_MESSAGE = `El campo items debe ser una lista de 1 a ${EJES_MAP_ITEMS_LIMIT} elementos.`;
const MAP_ITEM_MESSAGE = "Cada elemento de items necesita oldRef, newRef o zoneOf.";
const ZONE_TYPE_MESSAGE = `El campo items.type debe ser ${Object.values(PADRON_TYPE).join(" o ")}.`;
const PADRON_TYPES: readonly unknown[] = Object.values(PADRON_TYPE);
const REFERENCE_PATTERN = /^\d+$/;
const INT4_MAX = 2147483647;

const referenceOf = (value: unknown, key: string): string => {
  if (typeof value !== "string" && typeof value !== "number") throw invalid(`El campo items.${key} debe ser un número entero.`);
  const text = String(value).trim();
  if (!REFERENCE_PATTERN.test(text)) throw invalid(`El campo items.${key} debe ser un número entero.`);
  return text;
};

function readOldRef(value: unknown): number {
  const reference = Number(referenceOf(value, "oldRef"));
  if (!Number.isSafeInteger(reference) || reference > INT4_MAX) throw invalid("El campo items.oldRef debe ser un entero.");
  return reference;
}

function readZoneType(value: unknown): PadronType {
  if (!PADRON_TYPES.includes(value)) throw invalid(ZONE_TYPE_MESSAGE);
  return value as PadronType;
}

const isPresent = (value: unknown): boolean => value !== undefined && value !== null;

function readMapItem(entry: unknown): EjesMapItem {
  if (!isRecord(entry)) throw invalid("Cada elemento de items debe ser un objeto.");
  const hasOld = isPresent(entry.oldRef);
  const hasNew = isPresent(entry.newRef);
  const hasZone = isPresent(entry.zoneOf);
  if (!hasOld && !hasNew && !hasZone) throw invalid(MAP_ITEM_MESSAGE);
  return {
    ...(hasOld ? { oldRef: readOldRef(entry.oldRef) } : {}),
    ...(hasNew ? { newRef: referenceOf(entry.newRef, "newRef") } : {}),
    ...(hasZone ? { zoneOf: referenceOf(entry.zoneOf, "zoneOf"), type: readZoneType(entry.type) } : {}),
  };
}

function readMapItems(body: JsonRecord): EjesMapItem[] {
  const value = body.items;
  if (!Array.isArray(value) || value.length === 0 || value.length > EJES_MAP_ITEMS_LIMIT) throw invalid(MAP_ITEMS_MESSAGE);
  return value.map(readMapItem);
}

function readTableRef(tables: JsonRecord, role: string): EjesTableRef {
  const entry = readRecord(tables, role);
  return { schema: readRequiredText(entry, "schema"), table: readRequiredText(entry, "table") };
}

/** The map request: the connection and the staging, road section and padrones tables of the start request; the map reads no other table. */
export function parseEjesGeometryMapRequest(body: JsonRecord): EjesGeometryMapParams {
  const tables = readRecord(body, "tables");
  return {
    config: toDbConfig(parseConnection(body)),
    staging: readTableRef(tables, EJES_TABLE_ROLE.STAGING),
    roadSection: readTableRef(tables, EJES_TABLE_ROLE.ROAD_SECTION),
    padrones: readTableRef(tables, EJES_TABLE_ROLE.PADRONES),
    items: readMapItems(body),
  };
}
