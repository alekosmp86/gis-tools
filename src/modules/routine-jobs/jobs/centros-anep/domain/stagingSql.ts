import { physicalColumn, qualifiedName, type TableLayout } from "../../actualizar-padron/domain/layouts";
import { DETAIL_LIST_LIMIT } from "../../shared/limits";
import { cte, jsonArrayOf, q, withClause } from "../../shared/sqlFragments";
import { CENTROS_COLUMN } from "../constants";

const ROWS_CTE = "s";
const DUPLICATES_CTE = "dup";

const damagedTextSql = (textColumns: readonly string[]): string =>
  textColumns.length === 0
    ? "false"
    : `(${textColumns.map((column) => `position(chr(65533) in COALESCE(s.${q(column)}::text, '')) > 0`).join(" OR ")})`;

function stagingRowsCte(layout: TableLayout, textColumns: readonly string[]): string {
  const geometry = `s.${physicalColumn(layout, CENTROS_COLUMN.GEOM)}`;
  return cte(
    ROWS_CTE,
    [
      "SELECT",
      `s.${physicalColumn(layout, CENTROS_COLUMN.RUEE)}::text AS ruee,`,
      `s.${physicalColumn(layout, CENTROS_COLUMN.SUBSISTEMA)}::text AS subsistema,`,
      `(${geometry} IS NULL OR ST_IsEmpty(${geometry})) AS empty_geometry,`,
      `${damagedTextSql(textColumns)} AS damaged_text`,
      `FROM ${qualifiedName(layout)} AS s`,
    ].join(" ")
  );
}

const countWhere = (condition: string): string => `(SELECT count(*) FROM ${q(ROWS_CTE)} WHERE ${condition})`;

const bySubsistemaSql = (source: string, subsistemaColumn: string, alias: string): string =>
  jsonArrayOf(
    `SELECT x.${subsistemaColumn}::text AS "value", count(*) AS "rows" FROM ${source} AS x GROUP BY x.${subsistemaColumn} ORDER BY x.${subsistemaColumn} NULLS LAST`,
    alias
  );

export function buildStagingChecksSql(layout: TableLayout, textColumns: readonly string[]): string {
  const ctes = [
    stagingRowsCte(layout, textColumns),
    cte(
      DUPLICATES_CTE,
      `SELECT ruee, count(*) AS rows FROM ${q(ROWS_CTE)} WHERE ruee IS NOT NULL GROUP BY ruee HAVING count(*) > 1`
    ),
  ];
  const repeatedList = jsonArrayOf(
    `SELECT ruee AS "ruee", rows AS "rows" FROM ${q(DUPLICATES_CTE)} ORDER BY rows DESC, ruee LIMIT ${DETAIL_LIST_LIMIT}`,
    "repeated_ruee_list"
  );
  return [
    withClause(ctes),
    "SELECT",
    `(SELECT count(*) FROM ${q(ROWS_CTE)}) AS "rows",`,
    `${countWhere("empty_geometry")} AS "empty_geometry",`,
    `${countWhere("ruee IS NULL")} AS "null_ruee",`,
    `${countWhere("subsistema IS NULL")} AS "null_subsistema",`,
    `${countWhere("damaged_text")} AS "damaged_text_rows",`,
    `(SELECT count(*) FROM ${q(DUPLICATES_CTE)}) AS "repeated_groups",`,
    `(SELECT COALESCE(sum(rows), 0) FROM ${q(DUPLICATES_CTE)}) AS "repeated_rows",`,
    `${repeatedList} AS "repeated_ruee",`,
    `${bySubsistemaSql(q(ROWS_CTE), q("subsistema"), "by_subsistema_list")} AS "by_subsistema"`,
  ].join("\n");
}

export function buildFinalCountsSql(layout: TableLayout): string {
  return [
    "SELECT",
    `(SELECT count(*) FROM ${qualifiedName(layout)}) AS "rows",`,
    `${bySubsistemaSql(qualifiedName(layout), physicalColumn(layout, CENTROS_COLUMN.SUBSISTEMA), "by_subsistema_list")} AS "by_subsistema"`,
  ].join("\n");
}
