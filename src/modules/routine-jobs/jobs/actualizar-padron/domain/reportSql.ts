import { quoteIdentifier } from "@/core/services/sqlStatements";
import { COLLIDING_KEY_LIMIT, SKIP_REASON, SKIPPED_GROUP_LIMIT, SKIPPED_SAMPLE_LIMIT, STAGING_COLUMN, WORK_COLUMN } from "../constants";
import { buildClassifyWith, DECIDED_CTE, REPAIRED_COLUMN, SKIP_REASON_COLUMN } from "./classifySql";
import type { PopulateLayouts } from "./layouts";

const q = (identifier: string): string => quoteIdentifier(identifier);
const decided = (column: string): string => `${q(DECIDED_CTE)}.${q(column)}`;
const FROM_DECIDED = `FROM ${q(DECIDED_CTE)}`;
const REASON = decided(SKIP_REASON_COLUMN);
const SKIPPED = `${REASON} IS NOT NULL`;
const ACCEPTED = `${REASON} IS NULL`;
const COLLIDING = `${REASON} = '${SKIP_REASON.CLAVE_DUPLICADA}'`;
const KEY_COLUMNS = [WORK_COLUMN.TYPE_PADRON, WORK_COLUMN.ID_PROVINCE, WORK_COLUMN.ID_CADASTRAL_LOCALITY, WORK_COLUMN.NUMBER];
const KEY_LIST = KEY_COLUMNS.map((column) => decided(column)).join(", ");

const COLLIDING_KEY_COUNT = `(SELECT count(*) FROM (SELECT 1 ${FROM_DECIDED} WHERE ${COLLIDING} GROUP BY ${KEY_LIST}) AS ${q("colliding")})`;

const topList = (select: string, alias: string): string =>
  `COALESCE((SELECT json_agg(${q(alias)}) FROM (${select}) AS ${q(alias)}), '[]'::json) AS ${q(alias)}`;

const reasonTop = `SELECT ${REASON} AS "reason", count(*) AS "count" ${FROM_DECIDED} WHERE ${SKIPPED} GROUP BY ${REASON} ORDER BY "count" DESC, "reason" LIMIT ${SKIPPED_GROUP_LIMIT}`;

const groupedTop = (column: string): string =>
  `SELECT ${decided(column)} AS "name", count(*) AS "count" ${FROM_DECIDED} WHERE ${SKIPPED} GROUP BY ${decided(column)} ORDER BY "count" DESC, "name" LIMIT ${SKIPPED_GROUP_LIMIT}`;

const SAMPLE_ORDER = [STAGING_COLUMN.NOMDEPTO, STAGING_COLUMN.NOMLOCCAT, STAGING_COLUMN.PADRON].map(decided).join(", ");

const samplesSql = (): string =>
  [
    `SELECT ${decided(STAGING_COLUMN.NOMDEPTO)} AS "department", ${decided(STAGING_COLUMN.NOMLOCCAT)} AS "locality"`,
    `, ${decided(STAGING_COLUMN.PADRON)}::text AS "padron", ${REASON} AS "reason"`,
    `${FROM_DECIDED} WHERE ${SKIPPED} ORDER BY ${SAMPLE_ORDER} LIMIT ${SKIPPED_SAMPLE_LIMIT}`,
  ].join(" ");

const collidingListSql = (): string =>
  [
    `SELECT ${decided(WORK_COLUMN.TYPE_PADRON)} AS "typePadron", ${decided(WORK_COLUMN.ID_PROVINCE)} AS "idProvince"`,
    `, ${decided(WORK_COLUMN.ID_CADASTRAL_LOCALITY)} AS "idCadastralLocality", ${decided(WORK_COLUMN.NUMBER)} AS "number", count(*) AS "rows"`,
    `${FROM_DECIDED} WHERE ${COLLIDING} GROUP BY ${KEY_LIST} ORDER BY "rows" DESC, "number" LIMIT ${COLLIDING_KEY_LIMIT}`,
  ].join(" ");

/* One statement over the shared chain: the totals row plus the bounded lists, none of them reads a geometry column. */
export function buildReportSql(layouts: PopulateLayouts): string {
  const columns = [
    `count(*) AS "rowsRead"`,
    `count(*) FILTER (WHERE ${ACCEPTED} AND ${decided(REPAIRED_COLUMN)}) AS "repaired"`,
    `count(*) FILTER (WHERE ${SKIPPED}) AS "skipped"`,
    `${COLLIDING_KEY_COUNT} AS "collidingKeys"`,
    topList(reasonTop, "byReason"),
    topList(groupedTop(STAGING_COLUMN.NOMDEPTO), "byDepartment"),
    topList(groupedTop(STAGING_COLUMN.NOMLOCCAT), "byLocality"),
    topList(samplesSql(), "samples"),
    topList(collidingListSql(), "collidingKeyList"),
  ];
  return `${buildClassifyWith(layouts, "report")} SELECT ${columns.join(", ")} ${FROM_DECIDED}`;
}
