import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { CargarLocalidadesParams } from "../types";

const TABLE_ROLE_LABEL = {
  PADRON: "padrón",
  LOCALITY_STAGING: "localidades de origen",
  PROVINCE: "provincias",
} as const;

const targetRoleLabel = (index: number): string => `destino ${index + 1}`;

interface NamedTable {
  role: string;
  label: string;
}

function namedTablesOf(params: CargarLocalidadesParams): NamedTable[] {
  const sources: NamedTable[] = [
    { role: TABLE_ROLE_LABEL.PADRON, label: buildQualifiedTableLabel(params.stagingSchema, params.padronTable) },
    {
      role: TABLE_ROLE_LABEL.LOCALITY_STAGING,
      label: buildQualifiedTableLabel(params.stagingSchema, params.localityStagingTable),
    },
    { role: TABLE_ROLE_LABEL.PROVINCE, label: buildQualifiedTableLabel(params.provinceSchema, params.provinceTable) },
  ];
  const targets = params.targets.map((target, index): NamedTable => ({
    role: targetRoleLabel(index),
    label: buildQualifiedTableLabel(target.schema, target.table),
  }));
  return [...sources, ...targets];
}

export function assertDistinctTables(params: CargarLocalidadesParams): void {
  const seen = new Map<string, string>();
  for (const { role, label } of namedTablesOf(params)) {
    const earlier = seen.get(label);
    if (earlier !== undefined) {
      throw new Error(`Las tablas de ${earlier} y ${role} no pueden ser la misma tabla (${label}). Elija tablas distintas.`);
    }
    seen.set(label, role);
  }
}

export const targetLabelsOf = (params: CargarLocalidadesParams): string[] =>
  params.targets.map((target) => buildQualifiedTableLabel(target.schema, target.table));
