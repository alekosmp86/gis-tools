import { assertDistinctCompletarTables } from "../jobs/completar-unidad-territorial/domain/tableRoles";
import { CONFIRM_REQUIRED_MESSAGE } from "../jobs/completar-unidad-territorial/services/preflight";
import type { CompletarParams } from "../jobs/completar-unidad-territorial/types";
import { assertTablesDistinct, invalid, parseConnection, readBoolean, readRequiredText, toDbConfig, type JsonRecord } from "./requestParsing";

export function parseCompletarUnidadTerritorialStartRequest(body: JsonRecord): CompletarParams {
  const params: CompletarParams = {
    config: toDbConfig(parseConnection(body)),
    unitSchema: readRequiredText(body, "unitSchema"),
    unitTable: readRequiredText(body, "unitTable"),
    addressMasterSchema: readRequiredText(body, "addressMasterSchema"),
    addressMasterTable: readRequiredText(body, "addressMasterTable"),
    dryRun: readBoolean(body, "dryRun"),
    confirm: readBoolean(body, "confirm"),
  };
  if (!params.dryRun && !params.confirm) throw invalid(CONFIRM_REQUIRED_MESSAGE);
  assertTablesDistinct(params, assertDistinctCompletarTables);
  return params;
}
