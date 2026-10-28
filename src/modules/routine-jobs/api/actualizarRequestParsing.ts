import { DEFAULT_LOCALITY_TYPE } from "../jobs/actualizar-padron/constants";
import { CONFIRM_REQUIRED_MESSAGE } from "../jobs/actualizar-padron/services/preflight";
import { assertDistinctTables } from "../jobs/actualizar-padron/services/resolveLayouts";
import type { ActualizarPadronOptions, ActualizarPadronParams } from "../jobs/actualizar-padron/types";
import {
  assertTablesDistinct,
  invalid,
  parseClearMode,
  parseConnection,
  readBoolean,
  readRecord,
  readRequiredText,
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

function parseOptions(body: JsonRecord, typeTable: string | undefined): ActualizarPadronOptions {
  const options = readRecord(body, "options");
  const clearMode = parseClearMode(options);
  return typeTable === undefined ? { clearMode } : { clearMode, localityType: readLocalityType(options) };
}

export function parseActualizarStartRequest(body: JsonRecord): ActualizarPadronParams {
  const connection = parseConnection(body);
  const typeTable = readOptionalTypeTable(body);
  const params: ActualizarPadronParams = {
    config: toDbConfig(connection),
    stagingSchema: readRequiredText(body, "stagingSchema"),
    stagingTable: readRequiredText(body, "stagingTable"),
    workSchema: readRequiredText(body, "workSchema"),
    workTable: readRequiredText(body, "workTable"),
    cartoSchema: readRequiredText(body, "cartoSchema"),
    padronTable: readRequiredText(body, "padronTable"),
    provinceTable: readRequiredText(body, "provinceTable"),
    localityTable: readRequiredText(body, "localityTable"),
    typeTable,
    options: parseOptions(body, typeTable),
    dryRun: readBoolean(body, "dryRun"),
    confirm: readBoolean(body, "confirm"),
  };
  if (!params.dryRun && !params.confirm) throw invalid(CONFIRM_REQUIRED_MESSAGE);
  assertTablesDistinct(params, assertDistinctTables);
  return params;
}
