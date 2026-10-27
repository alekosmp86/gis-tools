import { physicalColumn, qualifiedName } from "../../actualizar-padron/domain/layouts";
import {
  areaRatioOf,
  geometriesEqualSql,
  hausdorffDistanceSql,
  matchClassSql,
  MATCH_CLASS,
} from "../../shared/geometryCompare";
import { GEOMETRY_CHANGE_LIMIT, INSERTED_LIST_LIMIT, SAMPLE_LIMIT } from "../../shared/limits";
import { cte, jsonArrayOf, literal, q, withClause } from "../../shared/sqlFragments";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import { UNIT_TARGET_COLUMN } from "../constants";
import type { UnitLayouts, UnitOptions } from "../types";
import { CTE as SOURCE, unitSourceCtes } from "./sourceSql";

const TARGET_ALIAS = "tgt";
const MATCHED_TARGET_ALIAS = "t1";
const CLASSIFIED_ALIAS = "cl";

const CTE_TARGET = {
  COUNTS: "target_counts",
  CANDIDATES: "candidate_targets",
  MATCHED: "matched",
  MEASURED: "measured",
  CLASSIFIED: "classified",
  INSERTED: "inserted_rows",
  UPDATED: "updated_rows",
} as const;

const MATCHED_CLASSES: readonly string[] = [MATCH_CLASS.UNCHANGED, MATCH_CLASS.WITHIN_TOLERANCE, MATCH_CLASS.CHANGED];

const targetOf = (target: WritableTargetLayout, logical: string): string => `${TARGET_ALIAS}.${physicalColumn(target, logical)}`;
const classifiedOf = (column: string): string => `${CLASSIFIED_ALIAS}.${q(column)}`;
const classIs = (value: string): string => `${classifiedOf("class")} = ${literal(value)}`;
const inMatchedClasses = `${classifiedOf("class")} IN (${MATCHED_CLASSES.map(literal).join(", ")})`;
const fontDiffers = classifiedOf("font_differs");
const geometryAppliesOf = (options: UnitOptions): string => `(${classIs(MATCH_CLASS.CHANGED)} AND ${String(options.updateGeometries)})`;
const updatesRowSql = (options: UnitOptions): string =>
  `${inMatchedClasses} AND (${fontDiffers} OR ${geometryAppliesOf(options)})`;

const targetTableSql = (target: WritableTargetLayout): string => `${qualifiedName(target)} AS ${TARGET_ALIAS}`;

const typeFilterOf = (target: WritableTargetLayout, unitTypeId: number): string =>
  `${targetOf(target, UNIT_TARGET_COLUMN.ID_TERRITORIAL_UNIT_TYPE)} = ${unitTypeId}`;

function targetCountsCte(target: WritableTargetLayout, unitTypeId: number): string {
  return cte(
    CTE_TARGET.COUNTS,
    [
      `SELECT ${targetOf(target, UNIT_TARGET_COLUMN.ID_PROVINCE)} AS "id_province", ${targetOf(target, UNIT_TARGET_COLUMN.NAME)} AS "name",`,
      `count(*) AS "target_rows", min(${targetOf(target, UNIT_TARGET_COLUMN.ID)}) AS "target_id"`,
      `FROM ${targetTableSql(target)} WHERE ${typeFilterOf(target, unitTypeId)}`,
      `GROUP BY ${targetOf(target, UNIT_TARGET_COLUMN.ID_PROVINCE)}, ${targetOf(target, UNIT_TARGET_COLUMN.NAME)}`,
    ].join(" ")
  );
}

function candidateTargetsCte(target: WritableTargetLayout): string {
  return cte(
    CTE_TARGET.CANDIDATES,
    [
      `SELECT c."id_province", c."name", c."id_font", c."geom",`,
      `ST_Multi(ST_Transform(c."geom", ${target.srid})) AS "candidate_geometry",`,
      `tcn."target_rows", tcn."target_id"`,
      `FROM ${q(SOURCE.ACCEPTED)} AS c`,
      `LEFT JOIN ${q(CTE_TARGET.COUNTS)} AS tcn ON tcn."id_province" = c."id_province" AND tcn."name" = c."name"`,
    ].join(" ")
  );
}

function matchedCte(target: WritableTargetLayout): string {
  const matchedGeometry = `${MATCHED_TARGET_ALIAS}.${physicalColumn(target, UNIT_TARGET_COLUMN.GEOMETRY)}`;
  return cte(
    CTE_TARGET.MATCHED,
    [
      `SELECT ct.*, ${MATCHED_TARGET_ALIAS}.${physicalColumn(target, UNIT_TARGET_COLUMN.ID_FONT)} AS "target_font",`,
      `${matchedGeometry} AS "target_geometry",`,
      `${geometriesEqualSql(matchedGeometry, 'ct."candidate_geometry"')} AS "equal"`,
      `FROM ${q(CTE_TARGET.CANDIDATES)} AS ct`,
      `LEFT JOIN ${qualifiedName(target)} AS ${MATCHED_TARGET_ALIAS}`,
      `ON ${MATCHED_TARGET_ALIAS}.${physicalColumn(target, UNIT_TARGET_COLUMN.ID)} = ct."target_id" AND ct."target_rows" = 1`,
    ].join(" ")
  );
}

function measuredCte(): string {
  return cte(
    CTE_TARGET.MEASURED,
    `SELECT m.*, ${hausdorffDistanceSql('m."target_geometry"', 'm."candidate_geometry"', 'm."equal"')} AS "distance" FROM ${q(CTE_TARGET.MATCHED)} AS m`
  );
}

function classifiedCte(options: UnitOptions): string {
  return cte(
    CTE_TARGET.CLASSIFIED,
    [
      `SELECT m.*, ${matchClassSql(options.tolerance, 'm."target_rows"', 'm."equal"', 'm."distance"')} AS "class",`,
      `COALESCE(m."target_rows" = 1 AND m."target_font" IS DISTINCT FROM m."id_font", false) AS "font_differs"`,
      `FROM ${q(CTE_TARGET.MEASURED)} AS m`,
    ].join(" ")
  );
}

function classifyCtes(target: WritableTargetLayout, unitTypeId: number, options: UnitOptions): string[] {
  return [
    targetCountsCte(target, unitTypeId),
    candidateTargetsCte(target),
    matchedCte(target),
    measuredCte(),
    classifiedCte(options),
  ];
}

function missingSqlParts(target: WritableTargetLayout, unitTypeId: number): string[] {
  const keyMatch = `sk."id_province" = ${targetOf(target, UNIT_TARGET_COLUMN.ID_PROVINCE)} AND sk."name" = ${targetOf(target, UNIT_TARGET_COLUMN.NAME)}`;
  const notInSource = `NOT EXISTS (SELECT 1 FROM ${q(SOURCE.SOURCE_KEYS)} AS sk WHERE ${keyMatch})`;
  const missingWhere = `WHERE ${typeFilterOf(target, unitTypeId)} AND ${notInSource}`;
  return [
    `(SELECT count(*) FROM ${targetTableSql(target)} ${missingWhere}) AS "missing",`,
    `${jsonArrayOf(
      [
        `SELECT ${targetOf(target, UNIT_TARGET_COLUMN.ID_PROVINCE)}::text AS "provinceId", ${targetOf(target, UNIT_TARGET_COLUMN.NAME)} AS "name"`,
        `FROM ${targetTableSql(target)} ${missingWhere}`,
        `ORDER BY 1, 2 LIMIT ${SAMPLE_LIMIT}`,
      ].join(" "),
      "missing_samples"
    )} AS "missing_samples",`,
  ];
}

function geometryChangesSql(): string {
  return [
    `SELECT top."provinceId", top."name", top."distance", ${areaRatioOf('top."target_geometry"', 'top."candidate_geometry"')} AS "areaRatio"`,
    `FROM (SELECT ${classifiedOf("id_province")}::text AS "provinceId", ${classifiedOf("name")} AS "name",`,
    `${classifiedOf("distance")} AS "distance", ${classifiedOf("target_geometry")} AS "target_geometry",`,
    `${classifiedOf("candidate_geometry")} AS "candidate_geometry"`,
    `FROM ${q(CTE_TARGET.CLASSIFIED)} AS ${CLASSIFIED_ALIAS}`,
    `WHERE ${classIs(MATCH_CLASS.CHANGED)}`,
    `ORDER BY ${classifiedOf("distance")} DESC NULLS FIRST, ${classifiedOf("name")} LIMIT ${GEOMETRY_CHANGE_LIMIT}) AS top`,
    `ORDER BY top."distance" DESC NULLS FIRST, top."name"`,
  ].join(" ");
}

function classificationCountsSql(options: UnitOptions): string {
  return [
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.NEW)}) AS "new",`,
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.UNCHANGED)}) AS "unchanged",`,
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.WITHIN_TOLERANCE)}) AS "within_tolerance",`,
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.CHANGED)}) AS "changed",`,
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.AMBIGUOUS)}) AS "ambiguous",`,
    `count(*) FILTER (WHERE ${inMatchedClasses} AND ${fontDiffers}) AS "font_differs",`,
    `count(*) FILTER (WHERE ${updatesRowSql(options)}) AS "updates"`,
  ].join(" ");
}

export function buildUnitClassifySql(layouts: UnitLayouts, options: UnitOptions): string {
  const { target, unitTypeId } = layouts;
  return [
    withClause([...unitSourceCtes(layouts), ...classifyCtes(target, unitTypeId, options)]),
    "SELECT",
    `${classificationCountsSql(options)},`,
    ...missingSqlParts(target, unitTypeId),
    `${jsonArrayOf(
      [
        `SELECT ${classifiedOf("id_province")}::text AS "provinceId", ${classifiedOf("name")} AS "name"`,
        `FROM ${q(CTE_TARGET.CLASSIFIED)} AS ${CLASSIFIED_ALIAS} WHERE ${classIs(MATCH_CLASS.AMBIGUOUS)}`,
        `ORDER BY 1, 2 LIMIT ${SAMPLE_LIMIT}`,
      ].join(" "),
      "ambiguous_samples"
    )} AS "ambiguous_samples",`,
    `${jsonArrayOf(geometryChangesSql(), "geometry_changes")} AS "geometry_changes"`,
    `FROM ${q(CTE_TARGET.CLASSIFIED)} AS ${CLASSIFIED_ALIAS}`,
  ].join(" ");
}

function insertCte(target: WritableTargetLayout, unitTypeId: number): string {
  const insertList = [
    UNIT_TARGET_COLUMN.NAME,
    UNIT_TARGET_COLUMN.ID_TERRITORIAL_UNIT_TYPE,
    UNIT_TARGET_COLUMN.ID_FONT,
    UNIT_TARGET_COLUMN.ID_PROVINCE,
    UNIT_TARGET_COLUMN.GEOMETRY,
  ]
    .map((logical) => physicalColumn(target, logical))
    .join(", ");
  return cte(
    CTE_TARGET.INSERTED,
    [
      `INSERT INTO ${qualifiedName(target)} (${insertList})`,
      `SELECT ${classifiedOf("name")}, ${unitTypeId}, ${classifiedOf("id_font")}, ${classifiedOf("id_province")}, ${classifiedOf("candidate_geometry")}`,
      `FROM ${q(CTE_TARGET.CLASSIFIED)} AS ${CLASSIFIED_ALIAS}`,
      `WHERE ${classIs(MATCH_CLASS.NEW)} ORDER BY ${classifiedOf("id_province")}, ${classifiedOf("name")}`,
      `RETURNING ${physicalColumn(target, UNIT_TARGET_COLUMN.ID)} AS "id", ${physicalColumn(target, UNIT_TARGET_COLUMN.NAME)} AS "name",`,
      `${physicalColumn(target, UNIT_TARGET_COLUMN.ID_PROVINCE)} AS "id_province"`,
    ].join(" ")
  );
}

function updateCte(target: WritableTargetLayout, options: UnitOptions): string {
  const geometry = physicalColumn(target, UNIT_TARGET_COLUMN.GEOMETRY);
  const fontColumn = physicalColumn(target, UNIT_TARGET_COLUMN.ID_FONT);
  return cte(
    CTE_TARGET.UPDATED,
    [
      `UPDATE ${targetTableSql(target)}`,
      `SET ${geometry} = CASE WHEN ${geometryAppliesOf(options)} THEN ${classifiedOf("candidate_geometry")} ELSE ${targetOf(target, UNIT_TARGET_COLUMN.GEOMETRY)} END,`,
      `${fontColumn} = CASE WHEN ${fontDiffers} THEN ${classifiedOf("id_font")} ELSE ${targetOf(target, UNIT_TARGET_COLUMN.ID_FONT)} END`,
      `FROM ${q(CTE_TARGET.CLASSIFIED)} AS ${CLASSIFIED_ALIAS}`,
      `WHERE ${updatesRowSql(options)} AND ${targetOf(target, UNIT_TARGET_COLUMN.ID)} = ${classifiedOf("target_id")}`,
      `RETURNING ${targetOf(target, UNIT_TARGET_COLUMN.ID)} AS "id"`,
    ].join(" ")
  );
}

const INSERTED_LIST_SQL = [
  `SELECT ir."id", ir."name", ir."id_province"::text AS "provinceId"`,
  `FROM ${q(CTE_TARGET.INSERTED)} AS ir`,
  `ORDER BY ir."id_province", ir."name", ir."id" LIMIT ${INSERTED_LIST_LIMIT}`,
].join(" ");

export function buildUnitApplySql(layouts: UnitLayouts, options: UnitOptions): string {
  const { target, unitTypeId } = layouts;
  return [
    withClause([
      ...unitSourceCtes(layouts),
      ...classifyCtes(target, unitTypeId, options),
      insertCte(target, unitTypeId),
      updateCte(target, options),
    ]),
    "SELECT",
    `(SELECT count(*) FROM ${q(CTE_TARGET.INSERTED)}) AS "inserted",`,
    `(SELECT count(*) FROM ${q(CTE_TARGET.UPDATED)}) AS "updated",`,
    `${jsonArrayOf(INSERTED_LIST_SQL, "inserted_list")} AS "inserted_list"`,
  ].join(" ");
}
