import { CENTROS_CONFIRM_REQUIRED_MESSAGE, CENTROS_ROLES, type CentrosTableRole } from "../jobs/centros-anep/constants";
import { assertDistinctCentrosTables } from "../jobs/centros-anep/domain/tableRoles";
import type { CentrosParams, CentrosTableRef, CentrosTables } from "../jobs/centros-anep/types";
import {
  assertTablesDistinct,
  invalid,
  parseConnection,
  readBoolean,
  readRecord,
  readRequiredText,
  toDbConfig,
  type JsonRecord,
} from "./requestParsing";

function readTableRef(tables: JsonRecord, role: CentrosTableRole): CentrosTableRef {
  const entry = readRecord(tables, role);
  return { schema: readRequiredText(entry, "schema"), table: readRequiredText(entry, "table") };
}

function readTables(body: JsonRecord): CentrosTables {
  const tables = readRecord(body, "tables");
  return Object.fromEntries(CENTROS_ROLES.map((role) => [role, readTableRef(tables, role)])) as CentrosTables;
}

export function parseCentrosAnepStartRequest(body: JsonRecord): CentrosParams {
  const params: CentrosParams = {
    config: toDbConfig(parseConnection(body)),
    tables: readTables(body),
    dryRun: readBoolean(body, "dryRun"),
    confirm: readBoolean(body, "confirm"),
  };
  if (!params.dryRun && !params.confirm) throw invalid(CENTROS_CONFIRM_REQUIRED_MESSAGE);
  assertTablesDistinct(params, assertDistinctCentrosTables);
  return params;
}
