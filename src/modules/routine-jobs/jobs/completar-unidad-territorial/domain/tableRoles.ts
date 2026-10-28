import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { CompletarParams } from "../types";

const COMPLETAR_DISTINCT_TABLES_MESSAGE =
  "La tabla de unidades territoriales y la de direcciones maestras deben ser tablas distintas.";

export function assertDistinctCompletarTables(params: CompletarParams): void {
  const unit = buildQualifiedTableLabel(params.unitSchema, params.unitTable);
  const addressMaster = buildQualifiedTableLabel(params.addressMasterSchema, params.addressMasterTable);
  if (unit === addressMaster) {
    throw new Error(COMPLETAR_DISTINCT_TABLES_MESSAGE);
  }
}

export const completarLockTablesOf = (params: CompletarParams): Array<{ schema: string; table: string }> => [
  { schema: params.unitSchema, table: params.unitTable },
  { schema: params.addressMasterSchema, table: params.addressMasterTable },
];
