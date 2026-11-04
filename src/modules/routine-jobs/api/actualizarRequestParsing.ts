import { CONFIRM_REQUIRED_MESSAGE } from "../jobs/actualizar-padron/services/preflight";
import { isPlanId, PLAN_MISSING_MESSAGE, PLAN_UNKNOWN_MESSAGE } from "../jobs/actualizar-padron/domain/plan";
import { assertDistinctPadronTables } from "../jobs/actualizar-padron/domain/tableRoles";
import type { ActualizarPadronParams } from "../jobs/actualizar-padron/types";
import { parseOptions, readOptionalTypeTable } from "./actualizarOptionParsing";
import {
  assertTablesDistinct,
  invalid,
  parseConnection,
  readBoolean,
  readRequiredText,
  toDbConfig,
  type JsonRecord,
} from "./requestParsing";

export { parseGeometryMapRequest } from "./geometryMapRequestParsing";

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
