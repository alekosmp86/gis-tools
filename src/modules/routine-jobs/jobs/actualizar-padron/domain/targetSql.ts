import {
  areaRatioOf,
  geometriesEqualSql,
  hausdorffDistanceSql,
  matchClassSql,
  MATCH_CLASS,
} from "../../shared/geometryCompare";
import { DETAIL_LIST_LIMIT, SAMPLE_LIMIT } from "../../shared/limits";
import { cte, jsonArrayOf, literal, q, withClause } from "../../shared/sqlFragments";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import { STAGING_COLUMN, DESTINATION_COLUMN } from "../constants";
import type { ActualizarPadronOptions, PadronLayouts } from "../types";
import { candidateCtes, DECIDED_CTE, SKIP_REASON_COLUMN } from "./classifySql";
import { physicalColumn, qualifiedName } from "./layouts";

const TARGET_ALIAS = "tgt";
const MATCHED_TARGET_ALIAS = "t1";
const PLANNED_ALIAS = "pl";
const DEPARTMENT_COLUMN = STAGING_COLUMN.NOMDEPTO;
const LOCALITY_NAME_COLUMN = STAGING_COLUMN.NOMLOCCAT;

const CTE_TARGET = {
  CANDIDATES: "candidates",
  COUNTS: "target_counts",
  CANDIDATE_TARGETS: "candidate_targets",
  MATCHED: "matched",
  MEASURED: "measured",
  PLANNED: "planned",
  INSERTED: "inserted_rows",
  UPDATED: "updated_rows",
} as const;

const INSERT_COLUMNS: readonly string[] = [
  DESTINATION_COLUMN.TYPE_PADRON,
  DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY,
  DESTINATION_COLUMN.ID_PROVINCE,
  DESTINATION_COLUMN.NUMBER,
  DESTINATION_COLUMN.GEOMETRY,
];
const CANDIDATE_GEOMETRY = "candidate_geometry";
const KEY_COLUMNS: readonly string[] = [
  DESTINATION_COLUMN.TYPE_PADRON,
  DESTINATION_COLUMN.ID_PROVINCE,
  DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY,
  DESTINATION_COLUMN.NUMBER,
];

const targetOf = (target: WritableTargetLayout, logical: string): string => `${TARGET_ALIAS}.${physicalColumn(target, logical)}`;
const plannedOf = (column: string): string => `${PLANNED_ALIAS}.${q(column)}`;
const classIs = (value: string): string => `${plannedOf("class")} = ${literal(value)}`;
const targetTableSql = (target: WritableTargetLayout): string => `${qualifiedName(target)} AS ${TARGET_ALIAS}`;
const applyFlag = (options: ActualizarPadronOptions): string => String(options.updateGeometries);

/** NULL-safe key equality: a rural row has no locality id, and two NULL localities share the key. */
const sameKeySql = (left: string, right: string): string =>
  [
    ...KEY_COLUMNS.filter((column) => column !== DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY).map(
      (column) => `${left}.${q(column)} = ${right}.${q(column)}`
    ),
    `${left}.${q(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} IS NOT DISTINCT FROM ${right}.${q(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)}`,
  ].join(" AND ");

const sameKeyAsTargetSql = (target: WritableTargetLayout, candidate: string): string =>
  [
    `${candidate}.${q(DESTINATION_COLUMN.TYPE_PADRON)} = ${targetOf(target, DESTINATION_COLUMN.TYPE_PADRON)}`,
    `${candidate}.${q(DESTINATION_COLUMN.ID_PROVINCE)} = ${targetOf(target, DESTINATION_COLUMN.ID_PROVINCE)}`,
    `${candidate}.${q(DESTINATION_COLUMN.NUMBER)} = ${targetOf(target, DESTINATION_COLUMN.NUMBER)}`,
    `${candidate}.${q(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} IS NOT DISTINCT FROM ${targetOf(target, DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)}`,
  ].join(" AND ");

function candidatesCte(): string {
  return cte(
    CTE_TARGET.CANDIDATES,
    [
      `SELECT ${KEY_COLUMNS.map((column) => `d.${q(column)}`).join(", ")}, d.${q(DEPARTMENT_COLUMN)}, d.${q(LOCALITY_NAME_COLUMN)},`,
      `d.${q(DESTINATION_COLUMN.GEOMETRY)} AS ${q(CANDIDATE_GEOMETRY)}`,
      `FROM ${q(DECIDED_CTE)} AS d WHERE d.${q(SKIP_REASON_COLUMN)} IS NULL`,
    ].join(" ")
  );
}

function targetCountsCte(target: WritableTargetLayout): string {
  return cte(
    CTE_TARGET.COUNTS,
    [
      `SELECT ${targetOf(target, DESTINATION_COLUMN.TYPE_PADRON)} AS ${q(DESTINATION_COLUMN.TYPE_PADRON)},`,
      `${targetOf(target, DESTINATION_COLUMN.ID_PROVINCE)} AS ${q(DESTINATION_COLUMN.ID_PROVINCE)},`,
      `${targetOf(target, DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} AS ${q(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)},`,
      `${targetOf(target, DESTINATION_COLUMN.NUMBER)} AS ${q(DESTINATION_COLUMN.NUMBER)},`,
      `count(*) AS "target_rows", min(${targetOf(target, DESTINATION_COLUMN.ID)}) AS "target_id"`,
      `FROM ${targetTableSql(target)} GROUP BY 1, 2, 3, 4`,
    ].join(" ")
  );
}

function candidateTargetsCte(): string {
  return cte(
    CTE_TARGET.CANDIDATE_TARGETS,
    [
      `SELECT c.*, tc."target_rows", tc."target_id"`,
      `FROM ${q(CTE_TARGET.CANDIDATES)} AS c`,
      `LEFT JOIN ${q(CTE_TARGET.COUNTS)} AS tc ON ${sameKeySql("tc", "c")}`,
    ].join(" ")
  );
}

function matchedCte(target: WritableTargetLayout): string {
  const matchedGeometry = `${MATCHED_TARGET_ALIAS}.${physicalColumn(target, DESTINATION_COLUMN.GEOMETRY)}`;
  return cte(
    CTE_TARGET.MATCHED,
    [
      `SELECT ct.*, ${matchedGeometry} AS "target_geometry",`,
      `${geometriesEqualSql(matchedGeometry, `ct.${q(CANDIDATE_GEOMETRY)}`)} AS "equal"`,
      `FROM ${q(CTE_TARGET.CANDIDATE_TARGETS)} AS ct`,
      `LEFT JOIN ${qualifiedName(target)} AS ${MATCHED_TARGET_ALIAS}`,
      `ON ${MATCHED_TARGET_ALIAS}.${physicalColumn(target, DESTINATION_COLUMN.ID)} = ct."target_id" AND ct."target_rows" = 1`,
    ].join(" ")
  );
}

function measuredCte(): string {
  return cte(
    CTE_TARGET.MEASURED,
    `SELECT m.*, ${hausdorffDistanceSql('m."target_geometry"', `m.${q(CANDIDATE_GEOMETRY)}`, 'm."equal"')} AS "distance" FROM ${q(CTE_TARGET.MATCHED)} AS m`
  );
}

function plannedCte(options: ActualizarPadronOptions): string {
  return cte(
    CTE_TARGET.PLANNED,
    `SELECT m.*, ${matchClassSql(options.tolerance, 'm."target_rows"', 'm."equal"', 'm."distance"')} AS "class" FROM ${q(CTE_TARGET.MEASURED)} AS m`
  );
}

/** Destination rows whose key no staging candidate carries: counted and sampled, never removed. */
function unmatchedTargetSql(target: WritableTargetLayout): string {
  return [
    `FROM ${targetTableSql(target)}`,
    `LEFT JOIN ${q(CTE_TARGET.CANDIDATES)} AS c ON ${sameKeyAsTargetSql(target, "c")}`,
    `WHERE c.${q(DESTINATION_COLUMN.NUMBER)} IS NULL`,
  ].join(" ");
}

function classificationCountsSql(options: ActualizarPadronOptions): string {
  return [
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.NEW)}) AS "new",`,
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.UNCHANGED)}) AS "unchanged",`,
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.WITHIN_TOLERANCE)}) AS "within_tolerance",`,
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.CHANGED)}) AS "changed",`,
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.AMBIGUOUS)}) AS "ambiguous",`,
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.CHANGED)} AND ${applyFlag(options)}) AS "updates"`,
  ].join(" ");
}

function missingSqlParts(target: WritableTargetLayout): string[] {
  const keyColumns = [
    `${targetOf(target, DESTINATION_COLUMN.TYPE_PADRON)} AS "typePadron"`,
    `${targetOf(target, DESTINATION_COLUMN.ID_PROVINCE)} AS "provinceId"`,
    `${targetOf(target, DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} AS "localityId"`,
    `${targetOf(target, DESTINATION_COLUMN.NUMBER)} AS "number"`,
  ];
  return [
    `(SELECT count(*) ${unmatchedTargetSql(target)}) AS "missing",`,
    `${jsonArrayOf(
      [
        `SELECT ${keyColumns.join(", ")} ${unmatchedTargetSql(target)}`,
        `ORDER BY ${targetOf(target, DESTINATION_COLUMN.ID_PROVINCE)}, ${targetOf(target, DESTINATION_COLUMN.NUMBER)}`,
        `LIMIT ${SAMPLE_LIMIT}`,
      ].join(" "),
      "missing_samples"
    )} AS "missing_samples",`,
  ];
}

const keyListOf = (alias: string): string[] => [
  `${alias}.${q(DESTINATION_COLUMN.TYPE_PADRON)} AS "typePadron"`,
  `${alias}.${q(DESTINATION_COLUMN.ID_PROVINCE)} AS "provinceId"`,
  `${alias}.${q(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} AS "localityId"`,
  `${alias}.${q(DESTINATION_COLUMN.NUMBER)} AS "number"`,
];

function ambiguousSamplesSql(): string {
  return [
    `SELECT ${keyListOf(PLANNED_ALIAS).join(", ")} FROM ${q(CTE_TARGET.PLANNED)} AS ${PLANNED_ALIAS}`,
    `WHERE ${classIs(MATCH_CLASS.AMBIGUOUS)}`,
    `ORDER BY ${plannedOf(DESTINATION_COLUMN.ID_PROVINCE)}, ${plannedOf(DESTINATION_COLUMN.NUMBER)} LIMIT ${SAMPLE_LIMIT}`,
  ].join(" ");
}

function geometryChangesSql(): string {
  const changes = [
    ...keyListOf(PLANNED_ALIAS),
    `${plannedOf(DEPARTMENT_COLUMN)} AS "department"`,
    `${plannedOf(LOCALITY_NAME_COLUMN)} AS "locality"`,
    `${plannedOf("distance")} AS "distance"`,
    `${plannedOf("target_geometry")} AS "target_geometry"`,
    `${plannedOf(CANDIDATE_GEOMETRY)} AS "candidate_geometry"`,
  ];
  return [
    `SELECT top."typePadron", top."provinceId", top."localityId", top."number", top."department", top."locality", top."distance",`,
    `${areaRatioOf('top."target_geometry"', 'top."candidate_geometry"')} AS "areaRatio"`,
    `FROM (SELECT ${changes.join(", ")} FROM ${q(CTE_TARGET.PLANNED)} AS ${PLANNED_ALIAS}`,
    `WHERE ${classIs(MATCH_CLASS.CHANGED)}`,
    `ORDER BY ${plannedOf("distance")} DESC NULLS FIRST, ${plannedOf(DESTINATION_COLUMN.TYPE_PADRON)}, ${plannedOf(DESTINATION_COLUMN.ID_PROVINCE)},`,
    `${plannedOf(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} NULLS FIRST, ${plannedOf(DESTINATION_COLUMN.NUMBER)} LIMIT ${DETAIL_LIST_LIMIT}) AS top`,
    `ORDER BY top."distance" DESC NULLS FIRST, top."department", top."locality", top."number"`,
  ].join(" ");
}

function classifyCtes(layouts: PadronLayouts, options: ActualizarPadronOptions): string[] {
  const { target } = layouts;
  return [
    ...candidateCtes(layouts, "populate"),
    candidatesCte(),
    targetCountsCte(target),
    candidateTargetsCte(),
    matchedCte(target),
    measuredCte(),
    plannedCte(options),
  ];
}

export function buildPadronClassifySql(layouts: PadronLayouts, options: ActualizarPadronOptions): string {
  return [
    withClause(classifyCtes(layouts, options)),
    "SELECT",
    `${classificationCountsSql(options)},`,
    ...missingSqlParts(layouts.target),
    `${jsonArrayOf(ambiguousSamplesSql(), "ambiguous_samples")} AS "ambiguous_samples",`,
    `${jsonArrayOf(geometryChangesSql(), "geometry_changes")} AS "geometry_changes"`,
    `FROM ${q(CTE_TARGET.PLANNED)} AS ${PLANNED_ALIAS}`,
  ].join(" ");
}

function insertedRowsCte(target: WritableTargetLayout): string {
  const insertList = INSERT_COLUMNS.map((logical) => physicalColumn(target, logical)).join(", ");
  const selectList = INSERT_COLUMNS.map((logical) =>
    `${PLANNED_ALIAS}.${q(logical === DESTINATION_COLUMN.GEOMETRY ? CANDIDATE_GEOMETRY : logical)}`
  ).join(", ");
  return cte(
    CTE_TARGET.INSERTED,
    [
      `INSERT INTO ${qualifiedName(target)} (${insertList})`,
      `SELECT ${selectList} FROM ${q(CTE_TARGET.PLANNED)} AS ${PLANNED_ALIAS} WHERE ${classIs(MATCH_CLASS.NEW)}`,
      `ORDER BY ${plannedOf(DESTINATION_COLUMN.ID_PROVINCE)}, ${plannedOf(DESTINATION_COLUMN.NUMBER)}, ${plannedOf(DESTINATION_COLUMN.TYPE_PADRON)},`,
      `${plannedOf(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} NULLS FIRST`,
      `RETURNING ${KEY_COLUMNS.concat(DESTINATION_COLUMN.ID)
        .map((logical) => `${physicalColumn(target, logical)} AS ${q(logical)}`)
        .join(", ")}`,
    ].join(" ")
  );
}

/* Only the geometry is ever written here; id, id_address_master and every other column stay as they are. */
function updatedRowsCte(target: WritableTargetLayout, options: ActualizarPadronOptions): string {
  return cte(
    CTE_TARGET.UPDATED,
    [
      `UPDATE ${targetTableSql(target)}`,
      `SET ${physicalColumn(target, DESTINATION_COLUMN.GEOMETRY)} = ${PLANNED_ALIAS}.${q(CANDIDATE_GEOMETRY)}`,
      `FROM ${q(CTE_TARGET.PLANNED)} AS ${PLANNED_ALIAS}`,
      `WHERE ${classIs(MATCH_CLASS.CHANGED)} AND ${applyFlag(options)} AND ${targetOf(target, DESTINATION_COLUMN.ID)} = ${PLANNED_ALIAS}."target_id"`,
      `RETURNING ${targetOf(target, DESTINATION_COLUMN.ID)} AS "id"`,
    ].join(" ")
  );
}

const INSERTED_LIST_SQL = [
  `SELECT ir."id", pc.${q(DEPARTMENT_COLUMN)} AS "department", pc.${q(LOCALITY_NAME_COLUMN)} AS "locality",`,
  `ir.${q(DESTINATION_COLUMN.TYPE_PADRON)} AS "typePadron", ir.${q(DESTINATION_COLUMN.ID_PROVINCE)} AS "provinceId",`,
  `ir.${q(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} AS "localityId", ir.${q(DESTINATION_COLUMN.NUMBER)} AS "number"`,
  `FROM ${q(CTE_TARGET.INSERTED)} AS ir JOIN ${q(CTE_TARGET.PLANNED)} AS pc ON ${sameKeySql("ir", "pc")}`,
  `ORDER BY ir."id" LIMIT ${DETAIL_LIST_LIMIT}`,
].join(" ");

export function buildPadronApplySql(layouts: PadronLayouts, options: ActualizarPadronOptions): string {
  const { target } = layouts;
  return [
    withClause([...classifyCtes(layouts, options), insertedRowsCte(target), updatedRowsCte(target, options)]),
    "SELECT",
    `(SELECT count(*) FROM ${q(CTE_TARGET.INSERTED)}) AS "inserted",`,
    `(SELECT count(*) FROM ${q(CTE_TARGET.UPDATED)}) AS "updated",`,
    `${jsonArrayOf(INSERTED_LIST_SQL, "inserted_list")} AS "inserted_list"`,
  ].join(" ");
}
