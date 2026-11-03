import { DETAIL_LIST_LIMIT } from "../../shared/limits";
import { jsonArrayOf, q } from "../../shared/sqlFragments";
import { DESTINATION_COLUMN, LOCALITY_COLUMN, PROVINCE_COLUMN } from "../constants";
import type { PadronLayouts } from "../types";
import { physicalColumn, qualifiedName } from "./layouts";

const REMOVED_ALIAS = "rm";
const PROVINCE_ALIAS = "prov";
const LOCALITY_ALIAS = "loc";

const removedOf = (column: string): string => `${REMOVED_ALIAS}.${q(column)}`;

/** AP-108's capped list of deleted (or, in an analysis, deletable) padrones. `sourceSql` is a select whose rows carry the
    destination's logical columns (id, type_padron, id_province, id_cadastral_locality, number); the names are the destination's own. */
export function removedListSql({ province, locality }: PadronLayouts, sourceSql: string): string {
  const columns = [
    `${removedOf(DESTINATION_COLUMN.ID)} AS "id"`,
    `${removedOf(DESTINATION_COLUMN.TYPE_PADRON)} AS "typePadron"`,
    `${removedOf(DESTINATION_COLUMN.ID_PROVINCE)} AS "provinceId"`,
    `${PROVINCE_ALIAS}.${physicalColumn(province, PROVINCE_COLUMN.NAME)} AS "department"`,
    `${removedOf(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} AS "localityId"`,
    `${LOCALITY_ALIAS}.${physicalColumn(locality, LOCALITY_COLUMN.NAME)} AS "locality"`,
    `${removedOf(DESTINATION_COLUMN.NUMBER)} AS "number"`,
  ];
  const select = [
    `SELECT ${columns.join(", ")} FROM (${sourceSql}) AS ${REMOVED_ALIAS}`,
    `LEFT JOIN ${qualifiedName(province)} AS ${PROVINCE_ALIAS} ON ${PROVINCE_ALIAS}.${physicalColumn(province, PROVINCE_COLUMN.ID)} = ${removedOf(DESTINATION_COLUMN.ID_PROVINCE)}`,
    `LEFT JOIN ${qualifiedName(locality)} AS ${LOCALITY_ALIAS} ON ${LOCALITY_ALIAS}.${physicalColumn(locality, LOCALITY_COLUMN.ID)} = ${removedOf(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)}`,
    `ORDER BY "department", "locality", "number", "id" LIMIT ${DETAIL_LIST_LIMIT}`,
  ].join(" ");
  return jsonArrayOf(select, "removed_list");
}
