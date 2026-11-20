import {
  EJES_DEFAULT_TABLES,
  EJES_TABLE_ROLE,
  MANUAL_CANDIDATE_MAX_RADIUS_M,
  PADRON_TYPE,
  type EjesTableRole,
  type PadronType,
} from "../jobs/ejes-calles/constants";
import { EJES_MAP_ITEMS_LIMIT } from "../jobs/ejes-calles/domain/geometryMap";
import type { EjesGeometryMapParams, EjesMapItem, EjesTableRef } from "../jobs/ejes-calles/types";
import { invalid, isRecord, parseConnection, readRecord, readRequiredText, toDbConfig, type JsonRecord } from "./requestParsing";

const MAP_ITEMS_MESSAGE = `El campo items debe ser una lista de 1 a ${EJES_MAP_ITEMS_LIMIT} elementos.`;
const MAP_ITEM_MESSAGE = "Cada elemento de items necesita oldRef, newRef, zoneOf, localitiesOf o departmentOf.";
const ZONE_TYPE_MESSAGE = `El campo items.type debe ser ${Object.values(PADRON_TYPE).join(" o ")}.`;
const PADRON_TYPES: readonly unknown[] = Object.values(PADRON_TYPE);
const LOCALITY_MESSAGE = "El campo items.locality debe ser un texto no vacío y solo se admite junto a newRef.";
const OUTER_SPACES = /^ +| +$/g;
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

function readLocality(value: unknown): string {
  const text = typeof value === "string" ? value.replace(OUTER_SPACES, "") : "";
  if (text === "") throw invalid(LOCALITY_MESSAGE);
  return text;
}

const CANDIDATE_RADIUS_MESSAGE = `El campo items.radius debe ser un número mayor que 0 y como máximo ${MANUAL_CANDIDATE_MAX_RADIUS_M}.`;
const OTHER_STREETS_MESSAGE = "El campo items.otherStreets debe ser true o false.";
const CANDIDATE_OPTIONS_MESSAGE = "Los campos items.radius y items.otherStreets solo se admiten junto a candidatesOf.";

function readCandidateRadius(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MANUAL_CANDIDATE_MAX_RADIUS_M) {
    throw invalid(CANDIDATE_RADIUS_MESSAGE);
  }
  return value;
}

function readOtherStreets(value: unknown): boolean {
  if (typeof value !== "boolean") throw invalid(OTHER_STREETS_MESSAGE);
  return value;
}

/** The candidate options of an item: only with `candidatesOf`; each one is checked when present. */
function readCandidateOptions(entry: JsonRecord, hasCandidates: boolean): Pick<EjesMapItem, "radius" | "otherStreets"> {
  const hasRadius = isPresent(entry.radius);
  const hasOtherStreets = isPresent(entry.otherStreets);
  if ((hasRadius || hasOtherStreets) && !hasCandidates) throw invalid(CANDIDATE_OPTIONS_MESSAGE);
  return {
    ...(hasRadius ? { radius: readCandidateRadius(entry.radius) } : {}),
    ...(hasOtherStreets ? { otherStreets: readOtherStreets(entry.otherStreets) } : {}),
  };
}

function readMapItem(entry: unknown): EjesMapItem {
  if (!isRecord(entry)) throw invalid("Cada elemento de items debe ser un objeto.");
  const hasOld = isPresent(entry.oldRef);
  const hasNew = isPresent(entry.newRef);
  const hasZone = isPresent(entry.zoneOf);
  const hasLocalities = isPresent(entry.localitiesOf);
  const hasDepartment = isPresent(entry.departmentOf);
  const hasCandidates = isPresent(entry.candidatesOf);
  if (!hasOld && !hasNew && !hasZone && !hasLocalities && !hasDepartment && !hasCandidates) throw invalid(MAP_ITEM_MESSAGE);
  if (isPresent(entry.locality) && !hasNew) throw invalid(LOCALITY_MESSAGE);
  return {
    ...(hasOld ? { oldRef: readOldRef(entry.oldRef) } : {}),
    ...(hasNew ? { newRef: referenceOf(entry.newRef, "newRef") } : {}),
    ...(isPresent(entry.locality) ? { locality: readLocality(entry.locality) } : {}),
    ...(hasZone ? { zoneOf: referenceOf(entry.zoneOf, "zoneOf"), type: readZoneType(entry.type) } : {}),
    ...(hasLocalities ? { localitiesOf: referenceOf(entry.localitiesOf, "localitiesOf") } : {}),
    ...(hasDepartment ? { departmentOf: referenceOf(entry.departmentOf, "departmentOf") } : {}),
    ...(hasCandidates ? { candidatesOf: readOldRef(entry.candidatesOf) } : {}),
    ...readCandidateOptions(entry, hasCandidates),
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

/** The access points and addresses are read for the candidates only; a request that omits them gets the default tables of the ejes load. */
function readOptionalTableRef(tables: JsonRecord, role: EjesTableRole): EjesTableRef {
  return tables[role] === undefined ? EJES_DEFAULT_TABLES[role] : readTableRef(tables, role);
}

/** The map request: the connection and the staging, road section, padrones, localities and departments tables of the start request; the map reads no other table. */
export function parseEjesGeometryMapRequest(body: JsonRecord): EjesGeometryMapParams {
  const tables = readRecord(body, "tables");
  return {
    config: toDbConfig(parseConnection(body)),
    staging: readTableRef(tables, EJES_TABLE_ROLE.STAGING),
    roadSection: readTableRef(tables, EJES_TABLE_ROLE.ROAD_SECTION),
    padrones: readTableRef(tables, EJES_TABLE_ROLE.PADRONES),
    localities: readTableRef(tables, EJES_TABLE_ROLE.LOCALITIES),
    departments: readTableRef(tables, EJES_TABLE_ROLE.DEPARTMENTS),
    accessPoints: readOptionalTableRef(tables, EJES_TABLE_ROLE.ACCESS_POINT),
    addresses: readOptionalTableRef(tables, EJES_TABLE_ROLE.ADDRESS),
    items: readMapItems(body),
  };
}
