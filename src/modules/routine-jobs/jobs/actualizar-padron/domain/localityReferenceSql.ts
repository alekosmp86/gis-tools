import type { WritableTargetLayout } from "../../shared/tableResolution";
import { DESTINATION_COLUMN, LOCALITY_COLUMN } from "../constants";
import { physicalColumn, qualifiedName, type TableLayout } from "./layouts";

export function buildLocalityReferenceSql(target: WritableTargetLayout, locality: TableLayout): string {
  const localityId = physicalColumn(locality, LOCALITY_COLUMN.ID);
  const reference = `t.${physicalColumn(target, DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)}`;
  return [
    `SELECT count(*) AS "total",`,
    `count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM ${qualifiedName(locality)} l WHERE l.${localityId} = ${reference})) AS "unresolved"`,
    `FROM ${qualifiedName(target)} t WHERE ${reference} IS NOT NULL`,
  ].join(" ");
}
