import { physicalColumn, qualifiedName } from "../../actualizar-padron/domain/layouts";
import { FONT_TYPE_ID, TARGET_COLUMN } from "../constants";
import { GEOMETRY_CHANGE_LIMIT, INSERTED_LIST_LIMIT, SAMPLE_LIMIT } from "../../shared/limits";
import type { LocalityOptions, LocalityTargetLayout } from "../types";
import { CTE as SOURCE, sourceCtes, type SourceLayouts } from "./sourceSql";
import {
  areaRatioOf,
  geometriesEqualSql,
  hausdorffDistanceSql,
  matchClassSql,
  MATCH_CLASS,
} from "../../shared/geometryCompare";
import { cte, jsonArrayOf, literal, q, withClause } from "../../shared/sqlFragments";

const TARGET_ALIAS = "tgt";
const MATCHED_TARGET_ALIAS = "t1";

const CTE_TARGET = {
  COUNTS: "target_counts",
  CANDIDATES: "candidate_targets",
  MATCHED: "matched",
  MEASURED: "measured",
  CLASSIFIED: "classified",
  INSERTED: "inserted_rows",
  UPDATED: "updated_rows",
} as const;

const CLASSIFIED_ALIAS = "cl";

const WRITTEN_CLASSES = [MATCH_CLASS.UNCHANGED, MATCH_CLASS.WITHIN_TOLERANCE, MATCH_CLASS.CHANGED];

const targetOf = (target: LocalityTargetLayout, logical: string): string => `${TARGET_ALIAS}.${physicalColumn(target, logical)}`;
const classifiedOf = (column: string): string => `${CLASSIFIED_ALIAS}.${q(column)}`;
const classIs = (value: string): string => `${classifiedOf("class")} = ${literal(value)}`;
const codeDiffers = `${classifiedOf("target_code")}::text IS DISTINCT FROM ${classifiedOf("codloccat")}::text`;
const CODE_DIFFERS_SQL = `${classifiedOf("class")} IN (${WRITTEN_CLASSES.map(literal).join(", ")}) AND ${codeDiffers}`;

const notInSourceSql = (target: LocalityTargetLayout): string =>
  `NOT EXISTS (SELECT 1 FROM ${q(SOURCE.SOURCE_KEYS)} AS sk WHERE sk."id_province" = ${targetOf(target, TARGET_COLUMN.ID_PROVINCE)} AND sk."localidad" = ${targetOf(target, TARGET_COLUMN.NAME)})`;

const targetTableSql = (target: LocalityTargetLayout): string => `${qualifiedName(target)} AS ${TARGET_ALIAS}`;

function targetCountsCte(target: LocalityTargetLayout): string {
  return cte(
    CTE_TARGET.COUNTS,
    [
      `SELECT ${targetOf(target, TARGET_COLUMN.ID_PROVINCE)} AS "id_province", ${targetOf(target, TARGET_COLUMN.NAME)} AS "name",`,
      `count(*) AS "target_rows", min(${targetOf(target, TARGET_COLUMN.ID)}) AS "target_id"`,
      `FROM ${targetTableSql(target)} GROUP BY ${targetOf(target, TARGET_COLUMN.ID_PROVINCE)}, ${targetOf(target, TARGET_COLUMN.NAME)}`,
    ].join(" ")
  );
}

function candidateTargetsCte(target: LocalityTargetLayout): string {
  return cte(
    CTE_TARGET.CANDIDATES,
    [
      `SELECT c."id_province", c."nomdepto", c."localidad", c."codloccat",`,
      `ST_Multi(ST_Transform(c."geom", ${target.srid})) AS "candidate_geometry",`,
      `tcn."target_rows", tcn."target_id"`,
      `FROM ${q(SOURCE.ACCEPTED)} AS c`,
      `LEFT JOIN ${q(CTE_TARGET.COUNTS)} AS tcn ON tcn."id_province" = c."id_province" AND tcn."name" = c."localidad"`,
    ].join(" ")
  );
}

function matchedCte(target: LocalityTargetLayout): string {
  const matchedGeometry = `${MATCHED_TARGET_ALIAS}.${physicalColumn(target, TARGET_COLUMN.GEOMETRY)}`;
  return cte(
    CTE_TARGET.MATCHED,
    [
      `SELECT ct.*, ${MATCHED_TARGET_ALIAS}.${physicalColumn(target, TARGET_COLUMN.CODE)} AS "target_code",`,
      `${matchedGeometry} AS "target_geometry",`,
      `${geometriesEqualSql(matchedGeometry, 'ct."candidate_geometry"')} AS "equal"`,
      `FROM ${q(CTE_TARGET.CANDIDATES)} AS ct`,
      `LEFT JOIN ${qualifiedName(target)} AS ${MATCHED_TARGET_ALIAS}`,
      `ON ${MATCHED_TARGET_ALIAS}.${physicalColumn(target, TARGET_COLUMN.ID)} = ct."target_id" AND ct."target_rows" = 1`,
    ].join(" ")
  );
}

function measuredCte(): string {
  return cte(
    CTE_TARGET.MEASURED,
    [
      `SELECT m.*, ${hausdorffDistanceSql('m."target_geometry"', 'm."candidate_geometry"', 'm."equal"')} AS "distance"`,
      `FROM ${q(CTE_TARGET.MATCHED)} AS m`,
    ].join(" ")
  );
}

function classifiedCte(tolerance: number): string {
  return cte(
    CTE_TARGET.CLASSIFIED,
    [
      `SELECT m.*, ${matchClassSql(tolerance, 'm."target_rows"', 'm."equal"', 'm."distance"')} AS "class"`,
      `FROM ${q(CTE_TARGET.MEASURED)} AS m`,
    ].join(" ")
  );
}

function classifyCtes(target: LocalityTargetLayout, tolerance: number): string[] {
  return [
    targetCountsCte(target),
    candidateTargetsCte(target),
    matchedCte(target),
    measuredCte(),
    classifiedCte(tolerance),
  ];
}

function geometryChangesSql(): string {
  return [
    `SELECT top."department", top."name", top."distance", ${areaRatioOf('top."target_geometry"', 'top."candidate_geometry"')} AS "areaRatio"`,
    `FROM (SELECT ${classifiedOf("nomdepto")} AS "department", ${classifiedOf("localidad")} AS "name",`,
    `${classifiedOf("distance")} AS "distance", ${classifiedOf("target_geometry")} AS "target_geometry",`,
    `${classifiedOf("candidate_geometry")} AS "candidate_geometry"`,
    `FROM ${q(CTE_TARGET.CLASSIFIED)} AS ${CLASSIFIED_ALIAS}`,
    `WHERE ${classIs(MATCH_CLASS.CHANGED)}`,
    `ORDER BY ${classifiedOf("distance")} DESC NULLS FIRST, ${classifiedOf("localidad")} LIMIT ${GEOMETRY_CHANGE_LIMIT}) AS top`,
    `ORDER BY top."distance" DESC NULLS FIRST, top."name"`,
  ].join(" ");
}

function classificationCountsSql(): string {
  return [
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.NEW)}) AS "new",`,
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.UNCHANGED)}) AS "unchanged",`,
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.WITHIN_TOLERANCE)}) AS "within_tolerance",`,
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.CHANGED)}) AS "changed",`,
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.AMBIGUOUS)}) AS "ambiguous",`,
    `count(*) FILTER (WHERE ${CODE_DIFFERS_SQL}) AS "code_differs"`,
  ].join(" ");
}

function missingSqlParts(target: LocalityTargetLayout): string[] {
  const missingWhere = `WHERE ${notInSourceSql(target)}`;
  return [
    `(SELECT count(*) FROM ${targetTableSql(target)} ${missingWhere}) AS "missing",`,
    `${jsonArrayOf(
      [
        `SELECT pv."name" AS "department", ${targetOf(target, TARGET_COLUMN.NAME)} AS "name"`,
        `FROM ${targetTableSql(target)} LEFT JOIN ${q(SOURCE.PROVINCES)} AS pv ON pv."id" = ${targetOf(target, TARGET_COLUMN.ID_PROVINCE)}`,
        `${missingWhere} ORDER BY 1, 2 LIMIT ${SAMPLE_LIMIT}`,
      ].join(" "),
      "missing_samples"
    )} AS "missing_samples",`,
  ];
}

function samplesSqlParts(): string[] {
  const ambiguous = [
    `SELECT DISTINCT ${classifiedOf("nomdepto")} AS "department", ${classifiedOf("localidad")} AS "name"`,
    `FROM ${q(CTE_TARGET.CLASSIFIED)} AS ${CLASSIFIED_ALIAS}`,
    `WHERE ${classIs(MATCH_CLASS.AMBIGUOUS)} ORDER BY 1, 2 LIMIT ${SAMPLE_LIMIT}`,
  ].join(" ");
  const codes = [
    `SELECT ${classifiedOf("nomdepto")} AS "department", ${classifiedOf("localidad")} AS "name",`,
    `${classifiedOf("codloccat")}::text AS "code", ${classifiedOf("target_code")}::text AS "targetCode"`,
    `FROM ${q(CTE_TARGET.CLASSIFIED)} AS ${CLASSIFIED_ALIAS}`,
    `WHERE ${CODE_DIFFERS_SQL} ORDER BY 1, 2 LIMIT ${SAMPLE_LIMIT}`,
  ].join(" ");
  return [
    `${jsonArrayOf(ambiguous, "ambiguous_samples")} AS "ambiguous_samples",`,
    `${jsonArrayOf(codes, "code_differs_samples")} AS "code_differs_samples"`,
  ];
}

export function buildClassifySql(layouts: SourceLayouts, target: LocalityTargetLayout, options: LocalityOptions): string {
  return [
    withClause([...sourceCtes(layouts), ...classifyCtes(target, options.tolerance)]),
    "SELECT",
    `${classificationCountsSql()},`,
    ...missingSqlParts(target),
    ...samplesSqlParts(),
    `, ${jsonArrayOf(geometryChangesSql(), "geometry_changes")} AS "geometry_changes"`,
    `FROM ${q(CTE_TARGET.CLASSIFIED)} AS ${CLASSIFIED_ALIAS}`,
  ].join(" ");
}

function insertCte(target: LocalityTargetLayout): string {
  const columns = [TARGET_COLUMN.CODE, TARGET_COLUMN.NAME, TARGET_COLUMN.GEOMETRY, TARGET_COLUMN.ID_FONT_TYPE, TARGET_COLUMN.ID_PROVINCE];
  const insertList = columns.map((logical) => physicalColumn(target, logical)).join(", ");
  return cte(
    CTE_TARGET.INSERTED,
    [
      `INSERT INTO ${qualifiedName(target)} (${insertList})`,
      `SELECT ${classifiedOf("codloccat")}, ${classifiedOf("localidad")}, ${classifiedOf("candidate_geometry")}, ${FONT_TYPE_ID},`,
      `${classifiedOf("id_province")}`,
      `FROM ${q(CTE_TARGET.CLASSIFIED)} AS ${CLASSIFIED_ALIAS}`,
      `WHERE ${classIs(MATCH_CLASS.NEW)} ORDER BY ${classifiedOf("nomdepto")}, ${classifiedOf("localidad")}`,
      `RETURNING ${physicalColumn(target, TARGET_COLUMN.ID)} AS "id", ${physicalColumn(target, TARGET_COLUMN.NAME)} AS "name",`,
      `${physicalColumn(target, TARGET_COLUMN.ID_PROVINCE)} AS "id_province"`,
    ].join(" ")
  );
}

function updateCte(target: LocalityTargetLayout): string {
  return cte(
    CTE_TARGET.UPDATED,
    [
      `UPDATE ${targetTableSql(target)} SET ${physicalColumn(target, TARGET_COLUMN.GEOMETRY)} = ${classifiedOf("candidate_geometry")}`,
      `FROM ${q(CTE_TARGET.CLASSIFIED)} AS ${CLASSIFIED_ALIAS}`,
      `WHERE ${classIs(MATCH_CLASS.CHANGED)} AND ${targetOf(target, TARGET_COLUMN.ID)} = ${classifiedOf("target_id")}`,
      `RETURNING ${targetOf(target, TARGET_COLUMN.ID)} AS "id"`,
    ].join(" ")
  );
}

const INSERTED_LIST_SQL = [
  `SELECT ir."id", ir."name", pv."name" AS "department"`,
  `FROM ${q(CTE_TARGET.INSERTED)} AS ir`,
  `LEFT JOIN ${q(SOURCE.PROVINCES)} AS pv ON pv."id" = ir."id_province"`,
  `ORDER BY "department", ir."name", ir."id" LIMIT ${INSERTED_LIST_LIMIT}`,
].join(" ");

export function buildApplySql(layouts: SourceLayouts, target: LocalityTargetLayout, options: LocalityOptions): string {
  const updateCtes = options.updateGeometries ? [updateCte(target)] : [];
  const updatedCount = options.updateGeometries ? `(SELECT count(*) FROM ${q(CTE_TARGET.UPDATED)})` : "0";
  return [
    withClause([
      ...sourceCtes(layouts),
      ...classifyCtes(target, options.tolerance),
      insertCte(target),
      ...updateCtes,
    ]),
    "SELECT",
    `(SELECT count(*) FROM ${q(CTE_TARGET.INSERTED)}) AS "inserted",`,
    `${updatedCount} AS "updated",`,
    `${jsonArrayOf(INSERTED_LIST_SQL, "inserted_list")} AS "inserted_list"`,
  ].join(" ");
}
