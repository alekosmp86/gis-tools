import { DEFAULT_GEOMETRY_AREA_THRESHOLD, DEFAULT_LOCALITY_TYPE } from "../jobs/actualizar-padron/constants";
import type { ActualizarPadronOptions } from "../jobs/actualizar-padron/types";
import { readAcceptedGeometries, readPairChoices } from "./pairChoiceParsing";
import { invalid, readBoolean, readRecord, readTolerance, type JsonRecord } from "./requestParsing";

export function readOptionalTypeTable(body: JsonRecord): string | undefined {
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

function readAcceptAllGeometries(options: JsonRecord): boolean {
  if (options.acceptAllGeometries === undefined) return false;
  return readBoolean(options, "acceptAllGeometries");
}

export function parseOptions(body: JsonRecord, typeTable: string | undefined): ActualizarPadronOptions {
  const options = readRecord(body, "options");
  const shared = {
    tolerance: readTolerance(options),
    geometryAreaThreshold: readGeometryAreaThreshold(options),
    updateGeometries: readBoolean(options, "updateGeometries"),
    linkAddressMaster: readBoolean(options, "linkAddressMaster"),
    pairChoices: readPairChoices(options),
    acceptedGeometries: readAcceptedGeometries(options),
    acceptAllGeometries: readAcceptAllGeometries(options),
  };
  return typeTable === undefined ? shared : { ...shared, localityType: readLocalityType(options) };
}
