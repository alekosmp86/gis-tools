import { EJES_ROLES, REAL_RUN_UNAVAILABLE_MESSAGE, type EjesTableRole } from "../jobs/ejes-calles/constants";
import { assertDistinctEjesTables } from "../jobs/ejes-calles/domain/tableRoles";
import type { EjesParams, EjesTableRef, EjesTables } from "../jobs/ejes-calles/types";
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

function readTableRef(tables: JsonRecord, role: EjesTableRole): EjesTableRef {
  const entry = readRecord(tables, role);
  return { schema: readRequiredText(entry, "schema"), table: readRequiredText(entry, "table") };
}

function readTables(body: JsonRecord): EjesTables {
  const tables = readRecord(body, "tables");
  return Object.fromEntries(EJES_ROLES.map((role) => [role, readTableRef(tables, role)])) as EjesTables;
}

export function parseEjesCallesStartRequest(body: JsonRecord): EjesParams {
  const config = toDbConfig(parseConnection(body));
  const tables = readTables(body);
  if (!readBoolean(body, "dryRun")) throw invalid(REAL_RUN_UNAVAILABLE_MESSAGE);
  const params: EjesParams = { config, tables, dryRun: true };
  assertTablesDistinct(params, assertDistinctEjesTables);
  return params;
}
