import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { UnitParams } from "../types";

const UNIT_DISTINCT_TABLES_MESSAGE =
  "La tabla de localidades, la de tipos y la de unidades territoriales deben ser tablas distintas.";

const ADDRESS_MASTER_DISTINCT_MESSAGE =
  "La tabla de direcciones maestras no puede ser la de localidades, la de tipos ni la de unidades territoriales. Elija tablas distintas.";

export const linksAddressMasterOf = (params: UnitParams): boolean => params.options.linkAddressMaster === true;

export function assertDistinctUnitTables(params: UnitParams): void {
  const labels = [
    buildQualifiedTableLabel(params.localitySchema, params.localityTable),
    buildQualifiedTableLabel(params.typeSchema, params.typeTable),
    buildQualifiedTableLabel(params.targetSchema, params.targetTable),
  ];
  if (new Set(labels).size !== labels.length) {
    throw new Error(UNIT_DISTINCT_TABLES_MESSAGE);
  }
  if (params.addressMasterTable === undefined) return;
  const addressMasterLabel = buildQualifiedTableLabel(params.addressMasterTable.schema, params.addressMasterTable.table);
  if (labels.includes(addressMasterLabel)) {
    throw new Error(ADDRESS_MASTER_DISTINCT_MESSAGE);
  }
}
