import { quoteIdentifier } from "@/core/services/sqlStatements";
import { CLEAR_MODE, type ClearMode } from "../../cargar-padrones/constants";
import { STAGING_COLUMN, WORK_COLUMN } from "../constants";
import { buildClassifyWith, DECIDED_CTE, SKIP_REASON_COLUMN } from "./classifySql";
import { assertTargetSrid, physicalColumn, qualifiedName, type PopulateLayouts, type TableLayout } from "./layouts";

export type { PopulateLayouts, TableLayout, WorkLayout } from "./layouts";
export { buildReportSql } from "./reportSql";

const WORK_WRITE_COLUMNS: readonly string[] = [
  WORK_COLUMN.NUMBER,
  WORK_COLUMN.TYPE_PADRON,
  WORK_COLUMN.ID_CADASTRAL_LOCALITY,
  WORK_COLUMN.ID_PROVINCE,
  WORK_COLUMN.GEOMETRY,
];

const decidedColumn = (column: string): string => `${quoteIdentifier(DECIDED_CTE)}.${quoteIdentifier(column)}`;
const DECIDED_FROM = `FROM ${quoteIdentifier(DECIDED_CTE)}`;
const ACCEPTED_FILTER = `${decidedColumn(SKIP_REASON_COLUMN)} IS NULL`;

export function buildClearStatement(work: TableLayout, clearMode: ClearMode): string {
  return clearMode === CLEAR_MODE.TRUNCATE ? `TRUNCATE ${qualifiedName(work)}` : `DELETE FROM ${qualifiedName(work)}`;
}

export function buildStagingCountSql(staging: TableLayout): string {
  return `SELECT count(*) AS "count" FROM ${qualifiedName(staging)}`;
}

export function buildStagingSridProbeSql(staging: TableLayout, targetSrid: number): string {
  assertTargetSrid(targetSrid);
  const srid = `ST_SRID(${physicalColumn(staging, STAGING_COLUMN.GEOM)})`;
  return [
    `SELECT count(*) AS "unsupported" FROM ${qualifiedName(staging)}`,
    `WHERE ${srid} = 0 OR (${srid} <> ${targetSrid} AND NOT EXISTS (SELECT 1 FROM spatial_ref_sys WHERE srid = ${srid}))`,
  ].join(" ");
}

export function buildPopulateSql(layouts: PopulateLayouts): string {
  const insertList = WORK_WRITE_COLUMNS.map((logical) => physicalColumn(layouts.work, logical)).join(", ");
  const selectList = WORK_WRITE_COLUMNS.map((logical) => decidedColumn(logical)).join(", ");
  return [
    `INSERT INTO ${qualifiedName(layouts.work)} (${insertList})`,
    buildClassifyWith(layouts),
    `SELECT ${selectList} ${DECIDED_FROM} WHERE ${ACCEPTED_FILTER}`,
  ].join(" ");
}
