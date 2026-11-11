import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import { EJES_ROLES } from "../constants";
import type { EjesTables } from "../types";

const DISTINCT_TABLES_MESSAGE = "Cada rol de tabla debe ser una tabla distinta: no repita el mismo esquema y nombre.";

export const labelsOfEjesTables = (tables: EjesTables): string[] =>
  EJES_ROLES.map((role) => buildQualifiedTableLabel(tables[role].schema, tables[role].table));

export function assertDistinctEjesTables(params: { tables: EjesTables }): void {
  const labels = labelsOfEjesTables(params.tables);
  if (new Set(labels).size !== labels.length) throw new Error(DISTINCT_TABLES_MESSAGE);
}
