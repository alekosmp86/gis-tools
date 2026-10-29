import { q } from "../../shared/sqlFragments";
import { DETAIL_LIST_LIMIT, SAMPLE_LIMIT } from "../../shared/limits";
import { LOCALITY_REASON_GROUP_LIMIT, SKIP_REASON, SKIPPED_GROUP_LIMIT, STAGING_COLUMN, DESTINATION_COLUMN } from "../constants";
import { buildCandidateWith, DECIDED_CTE, REPAIRED_COLUMN, SKIP_REASON_COLUMN } from "./classifySql";
import type { PadronLayouts } from "../types";

const decided = (column: string): string => `${q(DECIDED_CTE)}.${q(column)}`;
const FROM_DECIDED = `FROM ${q(DECIDED_CTE)}`;
const REASON = decided(SKIP_REASON_COLUMN);
const SKIPPED = `${REASON} IS NOT NULL`;
const ACCEPTED = `${REASON} IS NULL`;
const COLLIDING = `${REASON} = '${SKIP_REASON.CLAVE_DUPLICADA}'`;
const KEY_COLUMNS = [DESTINATION_COLUMN.TYPE_PADRON, DESTINATION_COLUMN.ID_PROVINCE, DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY, DESTINATION_COLUMN.NUMBER];
const KEY_LIST = KEY_COLUMNS.map((column) => decided(column)).join(", ");

const COLLIDING_KEY_COUNT = `(SELECT count(*) FROM (SELECT 1 ${FROM_DECIDED} WHERE ${COLLIDING} GROUP BY ${KEY_LIST}) AS ${q("colliding")})`;

const topList = (select: string, alias: string): string =>
  `COALESCE((SELECT json_agg(${q(alias)}) FROM (${select}) AS ${q(alias)}), '[]'::json) AS ${q(alias)}`;

const reasonTop = `SELECT ${REASON} AS "reason", count(*) AS "count" ${FROM_DECIDED} WHERE ${SKIPPED} GROUP BY ${REASON} ORDER BY "count" DESC, "reason" LIMIT ${SKIPPED_GROUP_LIMIT}`;

const groupedTop = (column: string): string =>
  `SELECT ${decided(column)} AS "name", count(*) AS "count" ${FROM_DECIDED} WHERE ${SKIPPED} GROUP BY ${decided(column)} ORDER BY "count" DESC, "name" LIMIT ${SKIPPED_GROUP_LIMIT}`;

const LOCALITY_REASONS = [SKIP_REASON.LOCALIDAD_NO_ENCONTRADA, SKIP_REASON.LOCALIDAD_AMBIGUA];
const LOCALITY_REASON_LIST = LOCALITY_REASONS.map((reason) => `'${reason}'`).join(", ");

const localityReasonSql = (): string =>
  [
    `SELECT "ranked"."department", "ranked"."locality", "ranked"."reason", "ranked"."count"`,
    `FROM (SELECT ${decided(STAGING_COLUMN.NOMDEPTO)} AS "department", ${decided(STAGING_COLUMN.NOMLOCCAT)} AS "locality", ${REASON} AS "reason", count(*) AS "count"`,
    `, row_number() OVER (PARTITION BY ${REASON} ORDER BY count(*) DESC, ${decided(STAGING_COLUMN.NOMDEPTO)}, ${decided(STAGING_COLUMN.NOMLOCCAT)}) AS "rank"`,
    `${FROM_DECIDED} WHERE ${SKIPPED} AND ${REASON} IN (${LOCALITY_REASON_LIST})`,
    `GROUP BY ${decided(STAGING_COLUMN.NOMDEPTO)}, ${decided(STAGING_COLUMN.NOMLOCCAT)}, ${REASON}) AS "ranked"`,
    `WHERE "ranked"."rank" <= ${LOCALITY_REASON_GROUP_LIMIT}`,
    `ORDER BY "ranked"."count" DESC, "ranked"."department", "ranked"."locality", "ranked"."reason"`,
  ].join(" ");

const SAMPLE_ORDER = [STAGING_COLUMN.NOMDEPTO, STAGING_COLUMN.NOMLOCCAT, STAGING_COLUMN.PADRON].map(decided).join(", ");

const samplesSql = (): string =>
  [
    `SELECT ${decided(STAGING_COLUMN.NOMDEPTO)} AS "department", ${decided(STAGING_COLUMN.NOMLOCCAT)} AS "locality"`,
    `, ${decided(STAGING_COLUMN.PADRON)}::text AS "padron", ${REASON} AS "reason"`,
    `${FROM_DECIDED} WHERE ${SKIPPED} ORDER BY ${SAMPLE_ORDER} LIMIT ${SAMPLE_LIMIT}`,
  ].join(" ");

const skippedListSql = (): string =>
  [
    `SELECT ${REASON} AS "reason", ${decided(STAGING_COLUMN.NOMDEPTO)} AS "department", ${decided(STAGING_COLUMN.NOMLOCCAT)} AS "locality"`,
    `, ${decided(STAGING_COLUMN.PADRON)}::text AS "padron"`,
    `${FROM_DECIDED} WHERE ${SKIPPED} ORDER BY ${REASON}, ${SAMPLE_ORDER} LIMIT ${DETAIL_LIST_LIMIT}`,
  ].join(" ");

const collidingListSql = (): string =>
  [
    `SELECT ${decided(DESTINATION_COLUMN.TYPE_PADRON)} AS "typePadron", ${decided(DESTINATION_COLUMN.ID_PROVINCE)} AS "idProvince"`,
    `, ${decided(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} AS "idCadastralLocality", ${decided(DESTINATION_COLUMN.NUMBER)} AS "number", count(*) AS "rows"`,
    `${FROM_DECIDED} WHERE ${COLLIDING} GROUP BY ${KEY_LIST} ORDER BY "rows" DESC, "number" LIMIT ${SAMPLE_LIMIT}`,
  ].join(" ");

/* One statement over the shared chain: the totals row plus the bounded lists, none of them reads a geometry column. */
export function buildReportSql(layouts: PadronLayouts): string {
  const columns = [
    `count(*) AS "rowsRead"`,
    `count(*) FILTER (WHERE ${ACCEPTED} AND ${decided(REPAIRED_COLUMN)}) AS "repaired"`,
    `count(*) FILTER (WHERE ${SKIPPED}) AS "skipped"`,
    `${COLLIDING_KEY_COUNT} AS "collidingKeys"`,
    topList(reasonTop, "byReason"),
    topList(groupedTop(STAGING_COLUMN.NOMDEPTO), "byDepartment"),
    topList(groupedTop(STAGING_COLUMN.NOMLOCCAT), "byLocality"),
    topList(samplesSql(), "samples"),
    topList(skippedListSql(), "skippedList"),
    topList(collidingListSql(), "collidingKeyList"),
    topList(localityReasonSql(), "byLocalityAndReason"),
  ];
  return `${buildCandidateWith(layouts, "report")} SELECT ${columns.join(", ")} ${FROM_DECIDED}`;
}
