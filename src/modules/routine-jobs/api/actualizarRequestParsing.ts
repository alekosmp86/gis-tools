import { DEFAULT_LOCALITY_TYPE } from "../jobs/actualizar-padron/constants";
import { CONFIRM_REQUIRED_MESSAGE } from "../jobs/actualizar-padron/services/preflight";
import { assertDistinctPadronTables } from "../jobs/actualizar-padron/domain/tableRoles";
import type { ActualizarPadronOptions, ActualizarPadronParams } from "../jobs/actualizar-padron/types";
import {
  assertTablesDistinct,
  invalid,
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

function parseOptions(body: JsonRecord, typeTable: string | undefined): ActualizarPadronOptions {
  const options = readRecord(body, "options");
  const shared = {
    tolerance: readTolerance(options),
    updateGeometries: readBoolean(options, "updateGeometries"),
    linkAddressMaster: readBoolean(options, "linkAddressMaster"),
  };
  return typeTable === undefined ? shared : { ...shared, localityType: readLocalityType(options) };
}

function readOptionalAddressMasterTable(body: JsonRecord, linkAddressMaster: boolean): string | undefined {
  return linkAddressMaster ? readRequiredText(body, "addressMasterTable") : undefined;
}

export function parseActualizarStartRequest(body: JsonRecord): ActualizarPadronParams {
  const connection = parseConnection(body);
  const typeTable = readOptionalTypeTable(body);
  const options = parseOptions(body, typeTable);
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
    dryRun: readBoolean(body, "dryRun"),
    confirm: readBoolean(body, "confirm"),
  };
  if (!params.dryRun && !params.confirm) throw invalid(CONFIRM_REQUIRED_MESSAGE);
  assertTablesDistinct(params, assertDistinctPadronTables);
  return params;
}
