import { CONFIRM_REQUIRED_MESSAGE } from "../jobs/unidad-territorial/services/preflight";
import { assertDistinctUnitTables } from "../jobs/unidad-territorial/domain/tableRoles";
import type { UnitParams } from "../jobs/unidad-territorial/types";
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

export function parseUnidadTerritorialStartRequest(body: JsonRecord): UnitParams {
  const options = readRecord(body, "options");
  const params: UnitParams = {
    config: toDbConfig(parseConnection(body)),
    localitySchema: readRequiredText(body, "localitySchema"),
    localityTable: readRequiredText(body, "localityTable"),
    typeSchema: readRequiredText(body, "typeSchema"),
    typeTable: readRequiredText(body, "typeTable"),
    targetSchema: readRequiredText(body, "targetSchema"),
    targetTable: readRequiredText(body, "targetTable"),
    options: {
      localityTypeName: readRequiredText(options, "localityTypeName"),
      tolerance: readTolerance(options),
      updateGeometries: readBoolean(options, "updateGeometries"),
    },
    dryRun: readBoolean(body, "dryRun"),
    confirm: readBoolean(body, "confirm"),
  };
  if (!params.dryRun && !params.confirm) throw invalid(CONFIRM_REQUIRED_MESSAGE);
  assertTablesDistinct(params, assertDistinctUnitTables);
  return params;
}
