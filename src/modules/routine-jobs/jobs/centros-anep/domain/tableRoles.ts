import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import { CENTROS_ROLES, CENTROS_TABLE_ROLE, type CentrosTableRole } from "../constants";
import type { CentrosTables } from "../types";

export const labelOfCentrosTable = (tables: CentrosTables, role: CentrosTableRole): string =>
  buildQualifiedTableLabel(tables[role].schema, tables[role].table);

export const labelsOfCentrosTables = (tables: CentrosTables): Record<CentrosTableRole, string> =>
  Object.fromEntries(CENTROS_ROLES.map((role) => [role, labelOfCentrosTable(tables, role)])) as Record<
    CentrosTableRole,
    string
  >;

export function assertDistinctCentrosTables(params: { tables: CentrosTables }): void {
  const staging = labelOfCentrosTable(params.tables, CENTROS_TABLE_ROLE.STAGING);
  const final = labelOfCentrosTable(params.tables, CENTROS_TABLE_ROLE.FINAL);
  if (staging === final) {
    throw new Error(
      `Las tablas de staging y final no pueden ser la misma tabla (${final}). Elija tablas distintas.`
    );
  }
}
