import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import { TABLE_LABEL } from "../constants";
import type { ActualizarPadronParams } from "../types";

const cartoLabelOf = (params: ActualizarPadronParams, table: string): string => buildQualifiedTableLabel(params.cartoSchema, table);

function tableRolesOf(params: ActualizarPadronParams): Array<[string, string]> {
  const roles: Array<[string, string]> = [
    [TABLE_LABEL.STAGING, buildQualifiedTableLabel(params.stagingSchema, params.stagingTable)],
    [TABLE_LABEL.TARGET, cartoLabelOf(params, params.targetTable)],
    [TABLE_LABEL.PROVINCE, cartoLabelOf(params, params.provinceTable)],
    [TABLE_LABEL.LOCALITY, cartoLabelOf(params, params.localityTable)],
  ];
  if (params.typeTable !== undefined) roles.push([TABLE_LABEL.TYPE, cartoLabelOf(params, params.typeTable)]);
  if (params.addressMasterTable !== undefined) {
    roles.push([TABLE_LABEL.ADDRESS_MASTER, cartoLabelOf(params, params.addressMasterTable)]);
  }
  return roles;
}

export function assertDistinctPadronTables(params: ActualizarPadronParams): void {
  const seen = new Map<string, string>();
  for (const [role, label] of tableRolesOf(params)) {
    const earlier = seen.get(label);
    if (earlier !== undefined) {
      throw new Error(`Las tablas de ${earlier} y ${role} no pueden ser la misma tabla (${label}). Elija tablas distintas.`);
    }
    seen.set(label, role);
  }
}
