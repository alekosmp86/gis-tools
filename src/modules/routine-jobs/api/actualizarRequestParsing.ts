import { DEFAULT_GEOMETRY_AREA_THRESHOLD, DEFAULT_LOCALITY_TYPE } from "../jobs/actualizar-padron/constants";
import { CONFIRM_REQUIRED_MESSAGE } from "../jobs/actualizar-padron/services/preflight";
import { isPlanId, PLAN_MISSING_MESSAGE, PLAN_UNKNOWN_MESSAGE } from "../jobs/actualizar-padron/domain/plan";
import { GEOMETRY_MAP_ITEMS_LIMIT } from "../jobs/actualizar-padron/domain/geometryMap";
import { assertDistinctPadronTables } from "../jobs/actualizar-padron/domain/tableRoles";
import type {
  ActualizarPadronOptions,
  ActualizarPadronParams,
  GeometryMapItem,
  GeometryMapStagingKey,
} from "../jobs/actualizar-padron/types";
import type { GeometryMapParams } from "../jobs/actualizar-padron/services/readGeometryMap";
import { PADRON_UNIT } from "../jobs/cargar-padrones/constants";
import { readAcceptedGeometries, readPairChoices } from "./pairChoiceParsing";
import {
  assertTablesDistinct,
  invalid,
  isRecord,
  parseConnection,
  readBoolean,
  readRecord,
  readRequiredText,
  readTolerance,
  toDbConfig,
  type JsonRecord,
} from "./requestParsing";

function readOptionalTypeTable(body: JsonRecord): string | undefined {
  const value = body.typeTable;
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw invalid("El campo typeTable debe ser texto.");
  return value.trim() === "" ? undefined : value;
}

function readLocalityType(options: JsonRecord): string {
  const value = options.localityType;
  if (value === undefined) return DEFAULT_LOCALITY_TYPE;
  if (typeof value !== "string") throw invalid("El campo localityType debe ser texto.");
  if (value.trim() === "") throw invalid("El campo localityType no puede estar vacío.");
  return value.trim();
}

const GEOMETRY_AREA_THRESHOLD_MESSAGE = "El campo geometryAreaThreshold debe ser un número entre 0 y 1.";

/** Absent means the default; the fraction is the symmetric-difference share of the union, so 0.05 is 5 %. */
function readGeometryAreaThreshold(options: JsonRecord): number {
  const value = options.geometryAreaThreshold;
  if (value === undefined) return DEFAULT_GEOMETRY_AREA_THRESHOLD;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw invalid(GEOMETRY_AREA_THRESHOLD_MESSAGE);
  }
  return value;
}

function parseOptions(body: JsonRecord, typeTable: string | undefined): ActualizarPadronOptions {
  const options = readRecord(body, "options");
  const shared = {
    tolerance: readTolerance(options),
    geometryAreaThreshold: readGeometryAreaThreshold(options),
    updateGeometries: readBoolean(options, "updateGeometries"),
    linkAddressMaster: readBoolean(options, "linkAddressMaster"),
    pairChoices: readPairChoices(options),
    acceptedGeometries: readAcceptedGeometries(options),
  };
  return typeTable === undefined ? shared : { ...shared, localityType: readLocalityType(options) };
}

/** Only a real run needs a plan: the analysis that produced it must have run first. */
function readPlanId(body: JsonRecord, dryRun: boolean): string | undefined {
  if (dryRun) return undefined;
  const value = body.planId;
  if (typeof value !== "string") throw invalid(PLAN_MISSING_MESSAGE);
  if (!isPlanId(value)) throw invalid(PLAN_UNKNOWN_MESSAGE);
  return value;
}

function readOptionalAddressMasterTable(body: JsonRecord, linkAddressMaster: boolean): string | undefined {
  return linkAddressMaster ? readRequiredText(body, "addressMasterTable") : undefined;
}

export function parseActualizarStartRequest(body: JsonRecord): ActualizarPadronParams {
  const connection = parseConnection(body);
  const typeTable = readOptionalTypeTable(body);
  const options = parseOptions(body, typeTable);
  const dryRun = readBoolean(body, "dryRun");
  const params: ActualizarPadronParams = {
    config: toDbConfig(connection),
    stagingSchema: readRequiredText(body, "stagingSchema"),
    stagingTable: readRequiredText(body, "stagingTable"),
    cartoSchema: readRequiredText(body, "cartoSchema"),
    targetTable: readRequiredText(body, "targetTable"),
    provinceTable: readRequiredText(body, "provinceTable"),
    localityTable: readRequiredText(body, "localityTable"),
    typeTable,
    addressMasterTable: readOptionalAddressMasterTable(body, options.linkAddressMaster),
    options,
    dryRun,
    confirm: readBoolean(body, "confirm"),
  };
  if (!params.dryRun && !params.confirm) throw invalid(CONFIRM_REQUIRED_MESSAGE);
  assertTablesDistinct(params, assertDistinctPadronTables);
  return { ...params, planId: readPlanId(body, dryRun) };
}

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
