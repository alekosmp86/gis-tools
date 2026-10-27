import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { UnitParams } from "../types";

const UNIT_DISTINCT_TABLES_MESSAGE =
  "La tabla de localidades, la de tipos y la de unidades territoriales deben ser tablas distintas.";

export function assertDistinctUnitTables(params: UnitParams): void {
  const labels = [
    buildQualifiedTableLabel(params.localitySchema, params.localityTable),
    buildQualifiedTableLabel(params.typeSchema, params.typeTable),
    buildQualifiedTableLabel(params.targetSchema, params.targetTable),
  ];
  if (new Set(labels).size !== labels.length) {
    throw new Error(UNIT_DISTINCT_TABLES_MESSAGE);
  }
}
