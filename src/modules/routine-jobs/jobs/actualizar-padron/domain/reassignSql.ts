import { cte, literal, q, withClause } from "../../shared/sqlFragments";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import { DESTINATION_COLUMN, REPLACEMENT_PART_MIN_PCT, REPLACEMENT_REFERENCE_COLUMN } from "../constants";
import type { PadronLayouts } from "../types";
import { DELETE_IDS_ID_COLUMN, DELETE_IDS_TABLE_SQL } from "./deleteIdsTable";
import { physicalColumn, qualifiedName } from "./layouts";
import { INSERTED_IDS_TABLE_SQL, REASSIGN_IDS_TABLE_SQL, SESSION_IDS_COLUMN } from "./reassignTables";
import { REVERT_COLUMN, REVERT_EXTRA_COLUMN, REVERT_KIND, REVERT_TABLE_SQL } from "./revertCapture";
import { pointOfSql, pointSource, refTableSql, tableLabelOf, type ReassignTarget, type ReferenceTable } from "./replacementSql";

/* AP-113's own statement: the real run's move of the referencing rows of the subdivided padrones to their nearest part. Kept apart
   from targetSql.ts so the stage's blanket "no UPDATE of references" guard can name this one file as its only exception. */

const CTE_REASSIGN = {
  IDS: "reassign_ids",
  RECEIVERS: "reassign_receivers",
  DELETE_ADD: "reassign_delete_ids",
} as const;

const OLD_ID = "old_id";
const PART_ID = "part_id";
const PART_GEOMETRY = "part_geometry";
const PART_COVER = "part_cover";
const OLD_ALIAS = "o";
const PART_ALIAS = "n";

export interface ReassignedTable {
  table: ReferenceTable;
  reassign: ReassignTarget;
}

export const reassignedTablesOf = (references: readonly ReferenceTable[]): ReassignedTable[] =>
  references.flatMap((table) => (table.reassign === undefined ? [] : [{ table, reassign: table.reassign }]));

const movedName = (index: number): string => `reassign_moved_${index}`;
const revertName = (index: number): string => `reassign_revert_${index}`;
const receiverOf = (column: string): string => `rc.${q(column)}`;

/* AP-109: the receivers of a padrón are the new padrones of its province that cover at least REPLACEMENT_PART_MIN_PCT of its area, among the ids this run inserted. */
function receiversCte(target: WritableTargetLayout): string {
  const column = (alias: string, logical: string): string => `${alias}.${physicalColumn(target, logical)}`;
  const oldGeometry = column(OLD_ALIAS, DESTINATION_COLUMN.GEOMETRY);
  const partGeometry = column(PART_ALIAS, DESTINATION_COLUMN.GEOMETRY);
  const overlap = `CASE WHEN ST_IsValid(${oldGeometry}) AND ST_IsValid(${partGeometry}) THEN ST_Area(ST_Intersection(${oldGeometry}, ${partGeometry})) END`;
  return cte(
    CTE_REASSIGN.RECEIVERS,
    [
      `SELECT ${column(OLD_ALIAS, DESTINATION_COLUMN.ID)} AS ${q(OLD_ID)}, ${column(PART_ALIAS, DESTINATION_COLUMN.ID)} AS ${q(PART_ID)}, ${partGeometry} AS ${q(PART_GEOMETRY)}, ov."overlap" * 100.0 / NULLIF(ov."area", 0) AS ${q(PART_COVER)}`,
      `FROM ${REASSIGN_IDS_TABLE_SQL} AS r`,
      `JOIN ${qualifiedName(target)} AS ${OLD_ALIAS} ON ${column(OLD_ALIAS, DESTINATION_COLUMN.ID)} = r.${q(SESSION_IDS_COLUMN)}`,
      `JOIN ${qualifiedName(target)} AS ${PART_ALIAS} ON ${partGeometry} && ${oldGeometry}`,
      `AND ${column(PART_ALIAS, DESTINATION_COLUMN.ID_PROVINCE)} = ${column(OLD_ALIAS, DESTINATION_COLUMN.ID_PROVINCE)}`,
      `JOIN ${INSERTED_IDS_TABLE_SQL} AS ins ON ins.${q(SESSION_IDS_COLUMN)} = ${column(PART_ALIAS, DESTINATION_COLUMN.ID)}`,
      `CROSS JOIN LATERAL (SELECT ${overlap} AS "overlap", ST_Area(${oldGeometry}) AS "area" OFFSET 0) AS ov`,
      `WHERE ov."overlap" * 100.0 / NULLIF(ov."area", 0) >= ${REPLACEMENT_PART_MIN_PCT}`,
    ].join(" ")
  );
}

/* AP-111: the nearest receiver by ST_Distance, a tie to the lowest part id; the point is moved to the receiver's SRID when it differs.
   A row with no point (NULL distance for every receiver) goes to the receiver covering most of the old padrón, a tie to the lowest part id. */
function nearestSql(): string {
  const point = `pt.${q("point")}`;
  const inPartSrid = `CASE WHEN ST_SRID(${point}) = ST_SRID(${receiverOf(PART_GEOMETRY)}) THEN ${point} ELSE ST_Transform(${point}, ST_SRID(${receiverOf(PART_GEOMETRY)})) END`;
  return [
    `SELECT ${receiverOf(PART_ID)} FROM ${q(CTE_REASSIGN.RECEIVERS)} AS rc WHERE ${receiverOf(OLD_ID)} = src.${q(REPLACEMENT_REFERENCE_COLUMN)}`,
    `ORDER BY ST_Distance(${receiverOf(PART_GEOMETRY)}, ${inPartSrid}), CASE WHEN ${point} IS NULL THEN -${receiverOf(PART_COVER)} END, ${receiverOf(PART_ID)} LIMIT 1`,
  ].join(" ");
}

/* The old id_padron comes from the joined subquery, not from RETURNING, which would give the new one. A row with no receiver is not updated, so the caller's count check fails and the run rolls back. */
function movedCte({ table, reassign }: ReassignedTable, index: number): string {
  const idColumn = q(REPLACEMENT_REFERENCE_COLUMN);
  const pk = q(reassign.pkColumn);
  const source = refTableSql(table.schema, table.table);
  const { join, geometry } = pointSource(reassign, "src", "cp");
  const best = [
    `SELECT src.${pk} AS "pk", src.${idColumn} AS ${q(OLD_ID)}, nearest.${q(PART_ID)} AS ${q(PART_ID)}, pt."point" IS NULL AS "no_point"`,
    `FROM ${source} AS src ${join}`,
    `CROSS JOIN LATERAL (SELECT ${pointOfSql(geometry, reassign.geography)} AS "point") AS pt`,
    `CROSS JOIN LATERAL (${nearestSql()}) AS nearest`,
    `WHERE src.${idColumn} IN (SELECT ${q(OLD_ID)} FROM ${q(CTE_REASSIGN.IDS)})`,
  ].join(" ");
  return cte(
    movedName(index),
    [
      `UPDATE ${source} AS rt SET ${idColumn} = best.${q(PART_ID)}`,
      `FROM (${best}) AS best WHERE rt.${pk} = best."pk"`,
      `RETURNING best.${q(OLD_ID)} AS ${q(OLD_ID)}, rt.${pk}::text AS "pk", best."no_point" AS "no_point"`,
    ].join(" ")
  );
}

/* AP-113: kind R keeps the table, its primary key column and value, and the old id_padron (in id). AP-122 reuses it for the padrones whose shape changed. */
export function reassignRevertCte(name: string, movedCteName: string, { table, reassign }: ReassignedTable): string {
  const columns = [REVERT_COLUMN.KIND, REVERT_COLUMN.ID, REVERT_EXTRA_COLUMN.REF_TABLE, REVERT_EXTRA_COLUMN.REF_KEY_COLUMN, REVERT_EXTRA_COLUMN.REF_KEY];
  return cte(
    name,
    [
      `INSERT INTO ${REVERT_TABLE_SQL} (${columns.map((column) => q(column)).join(", ")})`,
      `SELECT ${literal(REVERT_KIND.REASSIGNED)}, mv.${q(OLD_ID)}::integer, ${literal(refTableSql(table.schema, table.table))}, ${literal(reassign.pkColumn)}, mv."pk"`,
      `FROM ${q(movedCteName)} AS mv RETURNING ${q(REVERT_COLUMN.KIND)}`,
    ].join(" ")
  );
}

const revertCte = (item: ReassignedTable, index: number): string => reassignRevertCte(revertName(index), movedName(index), item);

/* AP-122: sets id_padron of the rows a picked CTE (columns pk, old_id, new_id) names, by primary key. */
export function pickedMoveCte(name: string, { table, reassign }: ReassignedTable, pickedCteName: string): string {
  const idColumn = q(REPLACEMENT_REFERENCE_COLUMN);
  const pk = q(reassign.pkColumn);
  return cte(
    name,
    [
      `UPDATE ${refTableSql(table.schema, table.table)} AS rt SET ${idColumn} = pc.${q("new_id")}`,
      `FROM ${q(pickedCteName)} AS pc WHERE rt.${pk} = pc."pk"`,
      `RETURNING pc.${q(OLD_ID)} AS ${q(OLD_ID)}, rt.${pk}::text AS "pk"`,
    ].join(" ")
  );
}

/* Every padrón of the set joins the delete ids: the delete statement still re-checks that no reference is left (AP-106). */
function deleteIdsAddCte(): string {
  return cte(
    CTE_REASSIGN.DELETE_ADD,
    [
      `INSERT INTO ${DELETE_IDS_TABLE_SQL} (${q(DELETE_IDS_ID_COLUMN)})`,
      `SELECT ${q(OLD_ID)} FROM ${q(CTE_REASSIGN.IDS)} RETURNING ${q(DELETE_IDS_ID_COLUMN)}`,
    ].join(" ")
  );
}

const sumOfCounts = (names: readonly string[]): string =>
  names.length === 0 ? "0" : names.map((name) => `(SELECT count(*) FROM ${q(name)})`).join(" + ");

const withoutPointCount = (names: readonly string[]): string =>
  names.length === 0 ? "0" : names.map((name) => `(SELECT count(*) FROM ${q(name)} WHERE "no_point")`).join(" + ");

const byTableSql =(tables: readonly ReassignedTable[]): string =>
  tables.length === 0
    ? `'{}'::json`
    : `json_build_object(${tables.map(({ table }, index) => `${literal(tableLabelOf(table))}, (SELECT count(*) FROM ${q(movedName(index))})`).join(", ")})`;

/** AP-113: its own statement, real run only, after the apply (the parts exist by then) and before the delete statement. `references`
    is the AP-102 table list; only the tables AP-110 allows are updated. It reads the padrones of the reassign temp table and the
    receivers among the apply's inserted ids, moves every referencing row, captures kind R and hands the padrones to the delete ids. */
export function buildPadronReassignSql(layouts: PadronLayouts, references: readonly ReferenceTable[]): string {
  const tables = reassignedTablesOf(references);
  const indexes = tables.map((_, index) => index);
  return [
    withClause([
      cte(CTE_REASSIGN.IDS, `SELECT ${q(SESSION_IDS_COLUMN)} AS ${q(OLD_ID)} FROM ${REASSIGN_IDS_TABLE_SQL}`),
      receiversCte(layouts.target),
      ...tables.map(movedCte),
      ...tables.map(revertCte),
      deleteIdsAddCte(),
    ]),
    "SELECT",
    `${sumOfCounts(indexes.map(movedName))} AS "moved",`,
    `${byTableSql(tables)} AS "by_table",`,
    `${withoutPointCount(indexes.map(movedName))} AS "without_point",`,
    `(SELECT count(*) FROM ${q(CTE_REASSIGN.DELETE_ADD)}) AS "padrones",`,
    `${sumOfCounts(indexes.map(revertName))} AS "revert_rows"`,
  ].join(" ");
}
