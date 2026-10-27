import { CONFIRM_REQUIRED_MESSAGE } from "../jobs/actualizar-padron/services/preflight";
import { assertDistinctTables } from "../jobs/actualizar-padron/services/resolveLayouts";
import type { ActualizarPadronParams } from "../jobs/actualizar-padron/types";
import {
  invalid,
  parseClearMode,
  parseConnection,
  readBoolean,
  readRecord,
  readRequiredText,
  toDbConfig,
  type JsonRecord,
} from "./requestParsing";

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function assertTablesDistinct(params: ActualizarPadronParams): void {
  try {
    assertDistinctTables(params);
  } catch (error: unknown) {
    throw invalid(messageOf(error));
  }
}

export function parseActualizarStartRequest(body: JsonRecord): ActualizarPadronParams {
  const connection = parseConnection(body);
  const params: ActualizarPadronParams = {
    config: toDbConfig(connection),
    stagingSchema: readRequiredText(body, "stagingSchema"),
    stagingTable: readRequiredText(body, "stagingTable"),
    workSchema: readRequiredText(body, "workSchema"),
    workTable: readRequiredText(body, "workTable"),
    padronTable: readRequiredText(body, "padronTable"),
    provinceTable: readRequiredText(body, "provinceTable"),
    localityTable: readRequiredText(body, "localityTable"),
    options: { clearMode: parseClearMode(readRecord(body, "options")) },
    dryRun: readBoolean(body, "dryRun"),
    confirm: readBoolean(body, "confirm"),
  };
  if (!params.dryRun && !params.confirm) throw invalid(CONFIRM_REQUIRED_MESSAGE);
  assertTablesDistinct(params);
  return params;
}
