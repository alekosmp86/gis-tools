import { cte, literal, q, withClause } from "../../shared/sqlFragments";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import { DESTINATION_COLUMN, REPLACEMENT_REFERENCE_COLUMN } from "../constants";
import type { PadronLayouts } from "../types";
import { DELETE_IDS_ID_COLUMN, DELETE_IDS_TABLE_SQL } from "./deleteIdsTable";
import { physicalColumn, qualifiedName } from "./layouts";
import { VERDICT_COLUMN } from "./reassignClassifySql";
import { pickedMoveCte, reassignedTablesOf, reassignRevertCte, type ReassignedTable } from "./reassignSql";
import {
  pointOfSql,
  pointSource,
  refTableSql,
  REMOVAL_CTE,
  tableLabelOf,
  UNPAIRED_NEW_CTE,
  UNPAIRED_NEW_GEOMETRY_COLUMN,
  type ReferenceTable,
} from "./replacementSql";
import { REVERT_COLUMN, REVERT_KIND, REVERT_TABLE_SQL } from "./revertCapture";

/* AP-121 to AP-123: the reassignment of the id_padron of rows whose padrón the run kept but reshaped. Only id_padron is written (kind R revert);
   the real run's statement and the analysis's read-only plan share the candidate and pick CTEs below. */

const CTE = {
  POST_APPLY: "reassign_changed_post",
  ALL: "reassign_changed_all",
  CHANGED: "reassign_changed",
  EXCLUDED: "reassign_changed_excluded",
} as const;

const OLD_ID = "old_id";
const NEW_ID = "new_id";
const CANDIDATE_ALIAS = "c";

const nameOf = (kind: string, index: number): string => `reassign_changed_${kind}_${index}`;

type Receivers = (candidate: string) => string;

const targetColumn = (target: WritableTargetLayout, logical: string): string => `t.${physicalColumn(target, logical)}`;

const insideSql = (geometry: string, point: string): string => `${geometry} && ${point} AND ST_Contains(${geometry}, ${point})`;

/* The changed padrones with the geometry they have after the apply: the real run reads the revert rows of kinds U and P, the analysis its post-apply plan. */
function changedAllCte(target: WritableTargetLayout, from: string, geometry: string): string {
  return cte(
    CTE.ALL,
    [
      `SELECT ${targetColumn(target, DESTINATION_COLUMN.ID)} AS "id", ${targetColumn(target, DESTINATION_COLUMN.ID_PROVINCE)} AS "id_province", ${geometry} AS "geometry"`,
      `FROM ${from} JOIN ${qualifiedName(target)} AS t ON ${targetColumn(target, DESTINATION_COLUMN.ID)} = ci."id"`,
    ].join(" ")
  );
}

function revertChangedFrom(): string {
  const kinds = [REVERT_KIND.UPDATED, REVERT_KIND.PAIRED].map((kind) => literal(kind)).join(", ");
  return `(SELECT DISTINCT rv.${q(REVERT_COLUMN.ID)} AS "id" FROM ${REVERT_TABLE_SQL} AS rv WHERE rv.${q(REVERT_COLUMN.KIND)} IN (${kinds})) AS ci`;
}

/* The padrones that a table not reassignable by AP-110 references are left out of the rule altogether. */
function changedCte(blocked: readonly ReferenceTable[]): string {
  const idColumn = q(REPLACEMENT_REFERENCE_COLUMN);
  const clauses = blocked.map(
    (table) => `AND NOT EXISTS (SELECT 1 FROM ${refTableSql(table.schema, table.table)} AS bt WHERE bt.${idColumn} = ca."id")`
  );
  return cte(CTE.CHANGED, `SELECT ca.* FROM ${q(CTE.ALL)} AS ca WHERE true ${clauses.join(" ")}`);
}

/* The point of a row in the SRID of its padron's geometry. A row whose padrón is outside the new shape and whose point is known is a candidate. */
function candidateCte({ table, reassign }: ReassignedTable, index: number): string {
  const idColumn = q(REPLACEMENT_REFERENCE_COLUMN);
  const { join, geometry } = pointSource(reassign, "src", "cp");
  const inSrid = `CASE WHEN raw."point" IS NULL THEN NULL WHEN ST_SRID(raw."point") = ST_SRID(ch."geometry") THEN raw."point" ELSE ST_Transform(raw."point", ST_SRID(ch."geometry")) END`;
  return cte(
    nameOf("cand", index),
    [
      `SELECT src.${q(reassign.pkColumn)} AS "pk", src.${idColumn} AS ${q(OLD_ID)}, ch."id_province" AS "id_province", pt."point" AS "point"`,
      `FROM ${refTableSql(table.schema, table.table)} AS src ${join}`,
      `JOIN ${q(CTE.CHANGED)} AS ch ON ch."id" = src.${idColumn}`,
      `CROSS JOIN LATERAL (SELECT ${pointOfSql(geometry, reassign.geography)} AS "point") AS raw`,
      `CROSS JOIN LATERAL (SELECT ${inSrid} AS "point") AS pt`,
      `WHERE pt."point" IS NOT NULL AND NOT COALESCE(ST_Contains(ch."geometry", pt."point"), false)`,
    ].join(" ")
  );
}

/* The padrones of the same province, other than the row's own, that contain the point: the lowest id wins and n counts them (n > 1 is ambiguous). */
function pickedCte(index: number, receivers: Receivers): string {
  return cte(
    nameOf("pick", index),
    [
      `SELECT ${CANDIDATE_ALIAS}."pk", ${CANDIDATE_ALIAS}.${q(OLD_ID)}, r.${q(NEW_ID)}, r."n"`,
      `FROM ${q(nameOf("cand", index))} AS ${CANDIDATE_ALIAS}`,
      `CROSS JOIN LATERAL (${receivers(CANDIDATE_ALIAS)}) AS r WHERE r."n" > 0`,
    ].join(" ")
  );
}

const sameProvinceSql = (candidate: string, province: string, id: string): string =>
  `${province} = ${candidate}."id_province" AND ${id} <> ${candidate}.${q(OLD_ID)}`;

/* The real run reads the destination after the apply, so the updated geometries and the inserted padrones are already in it; the padrones about to be deleted are not receivers. */
function realReceivers(target: WritableTargetLayout): Receivers {
  return (candidate) => {
    const id = targetColumn(target, DESTINATION_COLUMN.ID);
    const where = [
      sameProvinceSql(candidate, targetColumn(target, DESTINATION_COLUMN.ID_PROVINCE), id),
      insideSql(targetColumn(target, DESTINATION_COLUMN.GEOMETRY), `${candidate}."point"`),
      `${id} NOT IN (SELECT ${q(DELETE_IDS_ID_COLUMN)} FROM ${DELETE_IDS_TABLE_SQL})`,
    ];
    return `SELECT min(${id}) AS ${q(NEW_ID)}, count(*) AS "n" FROM ${qualifiedName(target)} AS t WHERE ${where.join(" AND ")}`;
  };
}

function excludedCte(): string {
  return cte(
    CTE.EXCLUDED,
    [
      `SELECT "id" FROM ${q(CTE.ALL)} UNION`,
      `SELECT ${q(VERDICT_COLUMN.OLD_ID)} FROM ${q(REMOVAL_CTE.VERDICTS)} WHERE ${q(VERDICT_COLUMN.REASON)} IS NULL`,
    ].join(" ")
  );
}

/* The analysis cannot read the apply's result: the receivers are the destination minus the changed and the deletable padrones, plus the changed ones with their planned geometry, plus the padrones the insert would add. */
function plannedReceivers(target: WritableTargetLayout): Receivers {
  return (candidate) => {
    const point = `${candidate}."point"`;
    const id = targetColumn(target, DESTINATION_COLUMN.ID);
    const existing = [
      `SELECT ${id} AS "id" FROM ${qualifiedName(target)} AS t`,
      `WHERE ${sameProvinceSql(candidate, targetColumn(target, DESTINATION_COLUMN.ID_PROVINCE), id)}`,
      `AND ${insideSql(targetColumn(target, DESTINATION_COLUMN.GEOMETRY), point)}`,
      `AND ${id} NOT IN (SELECT "id" FROM ${q(CTE.EXCLUDED)})`,
    ].join(" ");
    const changed = [
      `SELECT ca."id" FROM ${q(CTE.ALL)} AS ca WHERE ${sameProvinceSql(candidate, 'ca."id_province"', 'ca."id"')}`,
      `AND ${insideSql('ca."geometry"', point)}`,
    ].join(" ");
    const inserted = [
      `SELECT CAST(NULL AS integer) AS "id" FROM ${q(UNPAIRED_NEW_CTE)} AS nw`,
      `WHERE nw.${q(DESTINATION_COLUMN.ID_PROVINCE)} = ${candidate}."id_province" AND ${insideSql(`nw.${q(UNPAIRED_NEW_GEOMETRY_COLUMN)}`, point)}`,
    ].join(" ");
    return `SELECT min(x."id") AS ${q(NEW_ID)}, count(*) AS "n" FROM (${existing} UNION ALL ${changed} UNION ALL ${inserted}) AS x`;
  };
}

const blockedOf = (references: readonly ReferenceTable[]): ReferenceTable[] => references.filter((table) => table.reassign === undefined);

const countOfNames = (names: readonly string[], where = ""): string =>
  names.length === 0 ? "0" : names.map((name) => `(SELECT count(*) FROM ${q(name)}${where})`).join(" + ");

const byTableSql = (tables: readonly ReassignedTable[], names: readonly string[]): string =>
  tables.length === 0
    ? `'{}'::json`
    : `json_build_object(${tables.map(({ table }, index) => `${literal(tableLabelOf(table))}, (SELECT count(*) FROM ${q(names[index])})`).join(", ")})`;

const indexesOf = (tables: readonly ReassignedTable[]): number[] => tables.map((_, index) => index);

/** AP-122: its own statement, a real run only, after the apply and the subdivided reassignment and before the delete statement. The changed padrones are the revert rows of kinds U and P. */
export function buildPadronReassignChangedSql(layouts: PadronLayouts, references: readonly ReferenceTable[]): string {
  const { target } = layouts;
  const tables = reassignedTablesOf(references);
  const indexes = indexesOf(tables);
  const receivers = realReceivers(target);
  const names = (kind: string): string[] => indexes.map((index) => nameOf(kind, index));
  return [
    withClause([
      changedAllCte(target, revertChangedFrom(), targetColumn(target, DESTINATION_COLUMN.GEOMETRY)),
      changedCte(blockedOf(references)),
      ...tables.flatMap((item, index) => [
        candidateCte(item, index),
        pickedCte(index, receivers),
        pickedMoveCte(nameOf("moved", index), item, nameOf("pick", index)),
        reassignRevertCte(nameOf("revert", index), nameOf("moved", index), item),
      ]),
    ]),
    "SELECT",
    `${countOfNames(names("moved"))} AS "moved",`,
    `${countOfNames(names("pick"))} AS "selected",`,
    `${countOfNames(names("pick"), ' WHERE "n" > 1')} AS "ambiguous",`,
    `${byTableSql(tables, names("moved"))} AS "by_table",`,
    `${countOfNames(names("revert"))} AS "revert_rows"`,
  ].join(" ");
}

/** AP-123: the CTEs of the analysis's read-only plan. `postApplySql` selects (id, geometry) of every padrón the apply would update or pair, with the geometry it would have. Empty when no table can be reassigned. */
export function plannedReassignChangedCtes(layouts: PadronLayouts, references: readonly ReferenceTable[], postApplySql: string): string[] {
  const { target } = layouts;
  const tables = reassignedTablesOf(references);
  if (tables.length === 0) return [];
  const receivers = plannedReceivers(target);
  return [
    cte(CTE.POST_APPLY, postApplySql),
    changedAllCte(target, `${q(CTE.POST_APPLY)} AS ci`, 'ci."geometry"'),
    changedCte(blockedOf(references)),
    excludedCte(),
    ...tables.flatMap((item, index) => [candidateCte(item, index), pickedCte(index, receivers)]),
  ];
}

/** AP-123: the planned count, the planned ambiguous ones and the planned count per table, as columns of the classify statement. */
export function plannedReassignChangedCountsSql(references: readonly ReferenceTable[]): string[] {
  const tables = reassignedTablesOf(references);
  const names = indexesOf(tables).map((index) => nameOf("pick", index));
  return [
    `${countOfNames(names)} AS "reassigned_changed",`,
    `${countOfNames(names, ' WHERE "n" > 1')} AS "reassigned_changed_ambiguous",`,
    `${byTableSql(tables, names)} AS "reassigned_changed_by_table",`,
  ];
}
