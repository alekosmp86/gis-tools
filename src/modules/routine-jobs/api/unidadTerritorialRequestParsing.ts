import { CONFIRM_REQUIRED_MESSAGE } from "../jobs/unidad-territorial/services/preflight";
import { assertDistinctUnitTables } from "../jobs/unidad-territorial/domain/tableRoles";
import type { UnitAddressMasterTable, UnitParams } from "../jobs/unidad-territorial/types";
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

function readOptionalLinkAddressMaster(options: JsonRecord): boolean {
  const value = options.linkAddressMaster;
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw invalid("El campo linkAddressMaster debe ser verdadero o falso.");
  return value;
}

function readOptionalAddressMasterTable(body: JsonRecord, linkAddressMaster: boolean): UnitAddressMasterTable | undefined {
  if (!linkAddressMaster) return undefined;
  const addressMaster = readRecord(body, "addressMasterTable");
  return {
    schema: readRequiredText(addressMaster, "schema"),
    table: readRequiredText(addressMaster, "table"),
  };
}

export function parseUnidadTerritorialStartRequest(body: JsonRecord): UnitParams {
  const options = readRecord(body, "options");
  const linkAddressMaster = readOptionalLinkAddressMaster(options);
  const addressMasterTable = readOptionalAddressMasterTable(body, linkAddressMaster);
  const params: UnitParams = {
    config: toDbConfig(parseConnection(body)),
    localitySchema: readRequiredText(body, "localitySchema"),
    localityTable: readRequiredText(body, "localityTable"),
    typeSchema: readRequiredText(body, "typeSchema"),
    typeTable: readRequiredText(body, "typeTable"),
    targetSchema: readRequiredText(body, "targetSchema"),
    targetTable: readRequiredText(body, "targetTable"),
    ...(addressMasterTable === undefined ? {} : { addressMasterTable }),
    options: {
      localityTypeName: readRequiredText(options, "localityTypeName"),
      tolerance: readTolerance(options),
      updateGeometries: readBoolean(options, "updateGeometries"),
      linkAddressMaster,
    },
    dryRun: readBoolean(body, "dryRun"),
    confirm: readBoolean(body, "confirm"),
  };
  if (!params.dryRun && !params.confirm) throw invalid(CONFIRM_REQUIRED_MESSAGE);
  assertTablesDistinct(params, assertDistinctUnitTables);
  return params;
}
