import {
  areaRatioOf,
  geometriesEqualSql,
  hausdorffDistanceSql,
  matchClassSql,
  MATCH_CLASS,
} from "../../shared/geometryCompare";
import { DETAIL_LIST_LIMIT, PAIR_LIST_LIMIT, SAMPLE_LIMIT } from "../../shared/limits";
import { cte, jsonArrayOf, literal, q, withClause } from "../../shared/sqlFragments";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import {
  DESTINATION_COLUMN,
  LOCALITY_COLUMN,
  PAIR_AREA_RATIO_TOLERANCE,
  PAIR_OVERLAP_MIN,
  PAIR_STATUS,
  STAGING_COLUMN,
} from "../constants";
import type { ActualizarPadronOptions, PadronLayouts } from "../types";
import { candidateCtes, DECIDED_CTE, SKIP_REASON_COLUMN } from "./classifySql";
import { physicalColumn, qualifiedName } from "./layouts";
import { REVERT_COLUMN, REVERT_KIND, REVERT_TABLE_SQL, revertColumnList } from "./revertCapture";

const TARGET_ALIAS = "tgt";
const MATCHED_TARGET_ALIAS = "t1";
const PLANNED_ALIAS = "pl";
const UNMATCHED_ALIAS = "ut";
const PAIRABLE_ALIAS = "pt";
const DECIDED_ALIAS = "dc";
const PAIR_CANDIDATE_ALIAS = "pc";
const PAIR_MEASURED_ALIAS = "pm";
const PAIR_COUNTED_ALIAS = "cnt";
const PAIR_ALIAS = "pr";
const OLD_LOCALITY_ALIAS = "oldloc";
const DEPARTMENT_COLUMN = STAGING_COLUMN.NOMDEPTO;
const LOCALITY_NAME_COLUMN = STAGING_COLUMN.NOMLOCCAT;
const AREA_RATIO_LOWER = 1 - PAIR_AREA_RATIO_TOLERANCE;
const AREA_RATIO_UPPER = 1 + PAIR_AREA_RATIO_TOLERANCE;

const CTE_TARGET = {
  CANDIDATES: "candidates",
  COUNTS: "target_counts",
  CANDIDATE_TARGETS: "candidate_targets",
  MATCHED: "matched",
  MEASURED: "measured",
  PLANNED: "planned",
  UNMATCHED: "unmatched_targets",
  PAIRABLE: "pairable_targets",
  PAIR_CANDIDATES: "pair_candidates",
  PAIR_MEASURED: "pair_measured",
  PAIRS: "pairs",
  INSERTED: "inserted_rows",
  UPDATED: "updated_rows",
  PAIRED: "paired_rows",
  REVERT: "revert_rows",
} as const;

export interface ApplySqlOptions {
  captureRevert?: boolean;
}

const PAIR_COLUMN = {
  TARGET_ID: "target_id",
  OLD_TYPE_PADRON: "old_type_padron",
  OLD_LOCALITY_ID: "old_id_cadastral_locality",
  OLD_NUMBER: "old_number",
  TARGET_GEOMETRY: "target_geometry",
  EQUAL: "equal",
  DISTANCE: "distance",
  NEW_MATCHES: "new_matches",
  TARGET_MATCHES: "target_matches",
  STATUS: "status",
  TYPE_CHANGED: "type_changed",
  LOCALITY_CHANGED: "locality_changed",
  NUMBER_CHANGED: "number_changed",
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
const UNMATCHED_COLUMNS: readonly string[] = [DESTINATION_COLUMN.ID, DESTINATION_COLUMN.GEOMETRY, ...KEY_COLUMNS];
const PAIRED_KEY_COLUMNS: readonly string[] = [
  DESTINATION_COLUMN.TYPE_PADRON,
  DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY,
  DESTINATION_COLUMN.NUMBER,
];

const targetOf = (target: WritableTargetLayout, logical: string): string => `${TARGET_ALIAS}.${physicalColumn(target, logical)}`;
const plannedOf = (column: string): string => `${PLANNED_ALIAS}.${q(column)}`;
const unmatchedOf = (column: string): string => `${UNMATCHED_ALIAS}.${q(column)}`;
const pairableOf = (column: string): string => `${PAIRABLE_ALIAS}.${q(column)}`;
const pairOf = (column: string): string => `${PAIR_ALIAS}.${q(column)}`;
const classIs = (value: string): string => `${plannedOf("class")} = ${literal(value)}`;
const appliedCondition = (): string => `${pairOf(PAIR_COLUMN.STATUS)} = ${literal(PAIR_STATUS.APPLIED)}`;
const notAppliedCondition = (): string => `${pairOf(PAIR_COLUMN.STATUS)} <> ${literal(PAIR_STATUS.APPLIED)}`;
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

const keyListOf = (alias: string): string[] => [
  `${alias}.${q(DESTINATION_COLUMN.TYPE_PADRON)} AS "typePadron"`,
  `${alias}.${q(DESTINATION_COLUMN.ID_PROVINCE)} AS "provinceId"`,
  `${alias}.${q(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} AS "localityId"`,
  `${alias}.${q(DESTINATION_COLUMN.NUMBER)} AS "number"`,
];

const aliasedTargetColumns = (target: WritableTargetLayout, logicals: readonly string[]): string =>
  logicals.map((logical) => `${targetOf(target, logical)} AS ${q(logical)}`).join(", ");

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

/** Destination rows whose key no staging candidate carries: the only rows a pair can start from, never removed. */
function unmatchedTargetsCte(target: WritableTargetLayout): string {
  return cte(
    CTE_TARGET.UNMATCHED,
    [
      `SELECT ${aliasedTargetColumns(target, UNMATCHED_COLUMNS)}`,
      `FROM ${targetTableSql(target)}`,
      `LEFT JOIN ${q(CTE_TARGET.CANDIDATES)} AS c ON ${sameKeyAsTargetSql(target, "c")}`,
      `WHERE c.${q(DESTINATION_COLUMN.NUMBER)} IS NULL`,
    ].join(" ")
  );
}

/* Same province, bounding boxes that meet, the old footprint almost wholly covered by the new one and the areas within the ratio.
   CASE, not AND, guards the overlay: PostgreSQL does not short-circuit AND, and GEOS aborts the statement on invalid input. */
function footprintMatchSql(existing: string, incoming: string): string {
  const existingArea = `ST_Area(${existing})`;
  const shape = [
    `ST_Area(ST_Intersection(${existing}, ${incoming})) >= ${PAIR_OVERLAP_MIN} * ${existingArea}`,
    `ST_Area(${incoming}) BETWEEN ${AREA_RATIO_LOWER} * ${existingArea} AND ${AREA_RATIO_UPPER} * ${existingArea}`,
  ].join(" AND ");
  return `CASE WHEN ST_IsValid(${existing}) AND ST_IsValid(${incoming}) THEN ${shape} ELSE false END`;
}

function pairCandidateColumns(): string[] {
  const targetGeometry = pairableOf(DESTINATION_COLUMN.GEOMETRY);
  const newGeometry = plannedOf(CANDIDATE_GEOMETRY);
  return [
    ...KEY_COLUMNS.map((column) => plannedOf(column)),
    plannedOf(DEPARTMENT_COLUMN),
    plannedOf(LOCALITY_NAME_COLUMN),
    newGeometry,
    `${pairableOf(DESTINATION_COLUMN.ID)} AS ${q(PAIR_COLUMN.TARGET_ID)}`,
    `${pairableOf(DESTINATION_COLUMN.TYPE_PADRON)} AS ${q(PAIR_COLUMN.OLD_TYPE_PADRON)}`,
    `${pairableOf(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} AS ${q(PAIR_COLUMN.OLD_LOCALITY_ID)}`,
    `${pairableOf(DESTINATION_COLUMN.NUMBER)} AS ${q(PAIR_COLUMN.OLD_NUMBER)}`,
    `${targetGeometry} AS ${q(PAIR_COLUMN.TARGET_GEOMETRY)}`,
    `${geometriesEqualSql(targetGeometry, newGeometry)} AS ${q(PAIR_COLUMN.EQUAL)}`,
  ];
}

/* The && probe reads the destination table's GiST index; the footprint reads the unmatched copy of the geometry, so matched neighbours are dropped before it runs. */
function pairCandidatesCte(target: WritableTargetLayout): string {
  return cte(
    CTE_TARGET.PAIR_CANDIDATES,
    [
      `SELECT ${pairCandidateColumns().join(", ")}`,
      `FROM ${q(CTE_TARGET.PLANNED)} AS ${PLANNED_ALIAS}`,
      `JOIN ${targetTableSql(target)}`,
      `ON ${targetOf(target, DESTINATION_COLUMN.GEOMETRY)} && ${plannedOf(CANDIDATE_GEOMETRY)}`,
      `AND ${targetOf(target, DESTINATION_COLUMN.ID_PROVINCE)} = ${plannedOf(DESTINATION_COLUMN.ID_PROVINCE)}`,
      `JOIN ${q(CTE_TARGET.PAIRABLE)} AS ${PAIRABLE_ALIAS}`,
      `ON ${pairableOf(DESTINATION_COLUMN.ID)} = ${targetOf(target, DESTINATION_COLUMN.ID)}`,
      `WHERE ${classIs(MATCH_CLASS.NEW)}`,
      `AND ${footprintMatchSql(pairableOf(DESTINATION_COLUMN.GEOMETRY), plannedOf(CANDIDATE_GEOMETRY))}`,
    ].join(" ")
  );
}

/** Unmatched destination rows that no decided staging row carries, skipped or not: a skipped row still owns its key. */
function pairableTargetsCte(): string {
  return cte(
    CTE_TARGET.PAIRABLE,
    [
      `SELECT ${UNMATCHED_ALIAS}.* FROM ${q(CTE_TARGET.UNMATCHED)} AS ${UNMATCHED_ALIAS}`,
      `WHERE NOT EXISTS (SELECT 1 FROM ${q(DECIDED_CTE)} AS ${DECIDED_ALIAS} WHERE ${sameKeySql(DECIDED_ALIAS, UNMATCHED_ALIAS)})`,
    ].join(" ")
  );
}

/** The Hausdorff distance is measured for the footprint pairs only. */
function pairMeasuredCte(): string {
  const pairColumn = (column: string): string => `${PAIR_CANDIDATE_ALIAS}.${q(column)}`;
  const distance = hausdorffDistanceSql(
    pairColumn(PAIR_COLUMN.TARGET_GEOMETRY),
    pairColumn(CANDIDATE_GEOMETRY),
    pairColumn(PAIR_COLUMN.EQUAL)
  );
  return cte(
    CTE_TARGET.PAIR_MEASURED,
    `SELECT ${PAIR_CANDIDATE_ALIAS}.*, COALESCE(${distance}, 0) AS ${q(PAIR_COLUMN.DISTANCE)} FROM ${q(CTE_TARGET.PAIR_CANDIDATES)} AS ${PAIR_CANDIDATE_ALIAS}`
  );
}

function pairStatusSql(): string {
  const counted = (column: string): string => `${PAIR_COUNTED_ALIAS}.${q(column)}`;
  return [
    "CASE",
    `WHEN ${counted(PAIR_COLUMN.NEW_MATCHES)} > 1 OR ${counted(PAIR_COLUMN.TARGET_MATCHES)} > 1 THEN ${literal(PAIR_STATUS.NOT_APPLIED_AMBIGUOUS)}`,
    `ELSE ${literal(PAIR_STATUS.APPLIED)} END`,
  ].join(" ");
}

/** A pair is applied when both sides match exactly once; the Hausdorff distance is informational and never gates it. */
function pairsCte(): string {
  const measured = (column: string): string => `${PAIR_MEASURED_ALIAS}.${q(column)}`;
  const counted = (column: string): string => `${PAIR_COUNTED_ALIAS}.${q(column)}`;
  const newKey = [DESTINATION_COLUMN.TYPE_PADRON, DESTINATION_COLUMN.ID_PROVINCE, DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY, DESTINATION_COLUMN.NUMBER]
    .map((column) => measured(column))
    .join(", ");
  const changedSql = (column: string, oldColumn: string, alias: string): string =>
    `${counted(column)} IS DISTINCT FROM ${counted(oldColumn)} AS ${q(alias)}`;
  return cte(
    CTE_TARGET.PAIRS,
    [
      `SELECT ${PAIR_COUNTED_ALIAS}.*,`,
      `${pairStatusSql()} AS ${q(PAIR_COLUMN.STATUS)},`,
      `${changedSql(DESTINATION_COLUMN.TYPE_PADRON, PAIR_COLUMN.OLD_TYPE_PADRON, PAIR_COLUMN.TYPE_CHANGED)},`,
      `${changedSql(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY, PAIR_COLUMN.OLD_LOCALITY_ID, PAIR_COLUMN.LOCALITY_CHANGED)},`,
      `${changedSql(DESTINATION_COLUMN.NUMBER, PAIR_COLUMN.OLD_NUMBER, PAIR_COLUMN.NUMBER_CHANGED)}`,
      `FROM (SELECT ${PAIR_MEASURED_ALIAS}.*,`,
      `count(*) OVER (PARTITION BY ${newKey}) AS ${q(PAIR_COLUMN.NEW_MATCHES)},`,
      `count(*) OVER (PARTITION BY ${measured(PAIR_COLUMN.TARGET_ID)}) AS ${q(PAIR_COLUMN.TARGET_MATCHES)}`,
      `FROM ${q(CTE_TARGET.PAIR_MEASURED)} AS ${PAIR_MEASURED_ALIAS}) AS ${PAIR_COUNTED_ALIAS}`,
    ].join(" ")
  );
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
    unmatchedTargetsCte(target),
    pairableTargetsCte(),
    pairCandidatesCte(target),
    pairMeasuredCte(),
    pairsCte(),
  ];
}

const pairCountSql = (condition: string): string =>
  `(SELECT count(*) FROM ${q(CTE_TARGET.PAIRS)} AS ${PAIR_ALIAS} WHERE ${condition})`;

/** Each applied pair consumes exactly one new row (its new key is unique among the candidates and matches one pair). */
function classificationCountsSql(options: ActualizarPadronOptions): string {
  return [
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.NEW)}) - ${pairCountSql(appliedCondition())} AS "new",`,
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.UNCHANGED)}) AS "unchanged",`,
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.WITHIN_TOLERANCE)}) AS "within_tolerance",`,
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.CHANGED)}) AS "changed",`,
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.AMBIGUOUS)}) AS "ambiguous",`,
    `count(*) FILTER (WHERE ${classIs(MATCH_CLASS.CHANGED)} AND ${applyFlag(options)}) AS "updates"`,
  ].join(" ");
}

/* A new row claimed by two or more not-applied pairs is one candidate: its duplicate pairs count once. */
function pairCountsSql(): string {
  const notAppliedKeys = `SELECT DISTINCT ${KEY_COLUMNS.map((column) => pairOf(column)).join(", ")} FROM ${q(CTE_TARGET.PAIRS)} AS ${PAIR_ALIAS} WHERE ${notAppliedCondition()}`;
  return [
    `${pairCountSql(appliedCondition())} AS "pairs",`,
    `(SELECT count(*) FROM ${q(CTE_TARGET.PAIRS)} AS ${PAIR_ALIAS}) AS "pairs_total",`,
    `(SELECT count(*) FROM (${notAppliedKeys}) AS "not_applied_keys") AS "pairs_not_applied"`,
  ].join(" ");
}

/** Destination rows with no staging candidate that no applied pair claims: counted and sampled, never removed. */
function missingTargetsSql(): string {
  return [
    `FROM ${q(CTE_TARGET.UNMATCHED)} AS ${UNMATCHED_ALIAS}`,
    `WHERE NOT EXISTS (SELECT 1 FROM ${q(CTE_TARGET.PAIRS)} AS ${PAIR_ALIAS}`,
    `WHERE ${appliedCondition()} AND ${pairOf(PAIR_COLUMN.TARGET_ID)} = ${unmatchedOf(DESTINATION_COLUMN.ID)})`,
  ].join(" ");
}

function missingSqlParts(): string[] {
  return [
    `(SELECT count(*) ${missingTargetsSql()}) AS "missing",`,
    `${jsonArrayOf(
      [
        `SELECT ${keyListOf(UNMATCHED_ALIAS).join(", ")} ${missingTargetsSql()}`,
        `ORDER BY ${unmatchedOf(DESTINATION_COLUMN.ID_PROVINCE)}, ${unmatchedOf(DESTINATION_COLUMN.NUMBER)}`,
        `LIMIT ${SAMPLE_LIMIT}`,
      ].join(" "),
      "missing_samples"
    )} AS "missing_samples",`,
  ];
}

/** Every pair, applied or not, for the report; the lists are ordered by department, locality and padrón. */
function pairsListSql({ locality }: PadronLayouts): string {
  const oldLocalityId = `${OLD_LOCALITY_ALIAS}.${physicalColumn(locality, LOCALITY_COLUMN.ID)}`;
  const columns = [
    `${pairOf(PAIR_COLUMN.STATUS)} AS "status"`,
    `${pairOf(PAIR_COLUMN.TYPE_CHANGED)} AS "typeChanged"`,
    `${pairOf(PAIR_COLUMN.LOCALITY_CHANGED)} AS "localityChanged"`,
    `${pairOf(PAIR_COLUMN.NUMBER_CHANGED)} AS "numberChanged"`,
    `${pairOf(PAIR_COLUMN.DISTANCE)} AS "distance"`,
    `${pairOf(PAIR_COLUMN.TARGET_ID)} AS "oldId"`,
    `${pairOf(PAIR_COLUMN.OLD_TYPE_PADRON)} AS "oldTypePadron"`,
    `${pairOf(PAIR_COLUMN.OLD_LOCALITY_ID)} AS "oldLocalityId"`,
    `${OLD_LOCALITY_ALIAS}.${physicalColumn(locality, LOCALITY_COLUMN.NAME)} AS "oldLocality"`,
    `${pairOf(PAIR_COLUMN.OLD_NUMBER)} AS "oldNumber"`,
    `${pairOf(DESTINATION_COLUMN.ID_PROVINCE)} AS "provinceId"`,
    `${pairOf(DESTINATION_COLUMN.TYPE_PADRON)} AS "typePadron"`,
    `${pairOf(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} AS "localityId"`,
    `${pairOf(DESTINATION_COLUMN.NUMBER)} AS "number"`,
    `${pairOf(DEPARTMENT_COLUMN)} AS "department"`,
    `${pairOf(LOCALITY_NAME_COLUMN)} AS "locality"`,
  ];
  return [
    `SELECT ${columns.join(", ")} FROM ${q(CTE_TARGET.PAIRS)} AS ${PAIR_ALIAS}`,
    `LEFT JOIN ${qualifiedName(locality)} AS ${OLD_LOCALITY_ALIAS} ON ${oldLocalityId} = ${pairOf(PAIR_COLUMN.OLD_LOCALITY_ID)}`,
    `ORDER BY ${pairOf(DEPARTMENT_COLUMN)}, ${pairOf(LOCALITY_NAME_COLUMN)} NULLS FIRST, ${pairOf(DESTINATION_COLUMN.NUMBER)}`,
    `LIMIT ${PAIR_LIST_LIMIT}`,
  ].join(" ");
}

function ambiguousSamplesSql(): string {
  return [
    `SELECT ${keyListOf(PLANNED_ALIAS).join(", ")} FROM ${q(CTE_TARGET.PLANNED)} AS ${PLANNED_ALIAS}`,
    `WHERE ${classIs(MATCH_CLASS.AMBIGUOUS)}`,
    `ORDER BY ${plannedOf(DESTINATION_COLUMN.ID_PROVINCE)}, ${plannedOf(DESTINATION_COLUMN.NUMBER)} LIMIT ${SAMPLE_LIMIT}`,
  ].join(" ");
}

/* The area ratio is computed for every CHANGED row so the list ranks by it; the Hausdorff distance only breaks ties. */
function geometryChangesSql(): string {
  const changes = [
    ...keyListOf(PLANNED_ALIAS),
    `${plannedOf(DEPARTMENT_COLUMN)} AS "department"`,
    `${plannedOf(LOCALITY_NAME_COLUMN)} AS "locality"`,
    `${plannedOf("distance")} AS "distance"`,
    `${areaRatioOf(plannedOf("target_geometry"), plannedOf(CANDIDATE_GEOMETRY))} AS "areaRatio"`,
  ];
  return [
    `SELECT top."typePadron", top."provinceId", top."localityId", top."number", top."department", top."locality", top."distance", top."areaRatio"`,
    `FROM (SELECT ${changes.join(", ")} FROM ${q(CTE_TARGET.PLANNED)} AS ${PLANNED_ALIAS}`,
    `WHERE ${classIs(MATCH_CLASS.CHANGED)}`,
    `ORDER BY "areaRatio" DESC NULLS FIRST, ${plannedOf("distance")} DESC NULLS FIRST, ${plannedOf(DESTINATION_COLUMN.TYPE_PADRON)}, ${plannedOf(DESTINATION_COLUMN.ID_PROVINCE)},`,
    `${plannedOf(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} NULLS FIRST, ${plannedOf(DESTINATION_COLUMN.NUMBER)} LIMIT ${DETAIL_LIST_LIMIT}) AS top`,
    `ORDER BY top."areaRatio" DESC NULLS FIRST, top."distance" DESC NULLS FIRST, top."department", top."locality", top."number"`,
  ].join(" ");
}

export function buildPadronClassifySql(layouts: PadronLayouts, options: ActualizarPadronOptions): string {
  return [
    withClause(classifyCtes(layouts, options)),
    "SELECT",
    `${classificationCountsSql(options)},`,
    ...missingSqlParts(),
    `${pairCountsSql()},`,
    `${jsonArrayOf(pairsListSql(layouts), "pairs_list")} AS "pairs_list",`,
    `${jsonArrayOf(ambiguousSamplesSql(), "ambiguous_samples")} AS "ambiguous_samples",`,
    `${jsonArrayOf(geometryChangesSql(), "geometry_changes")} AS "geometry_changes"`,
    `FROM ${q(CTE_TARGET.PLANNED)} AS ${PLANNED_ALIAS}`,
  ].join(" ");
}

/** A new row consumed by an applied pair is not inserted: it is the row the pair's destination row now carries. */
function unpairedNewSql(): string {
  return `${classIs(MATCH_CLASS.NEW)} AND NOT EXISTS (SELECT 1 FROM ${q(CTE_TARGET.PAIRS)} AS ${PAIR_ALIAS} WHERE ${appliedCondition()} AND ${sameKeySql(PLANNED_ALIAS, PAIR_ALIAS)})`;
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
      `SELECT ${selectList} FROM ${q(CTE_TARGET.PLANNED)} AS ${PLANNED_ALIAS} WHERE ${unpairedNewSql()}`,
      `ORDER BY ${plannedOf(DESTINATION_COLUMN.ID_PROVINCE)}, ${plannedOf(DESTINATION_COLUMN.NUMBER)}, ${plannedOf(DESTINATION_COLUMN.TYPE_PADRON)},`,
      `${plannedOf(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} NULLS FIRST`,
      `RETURNING ${KEY_COLUMNS.concat(DESTINATION_COLUMN.ID)
        .map((logical) => `${physicalColumn(target, logical)} AS ${q(logical)}`)
        .join(", ")}`,
    ].join(" ")
  );
}

/* The old values come from the planned row the UPDATE joins: they were read from the same statement snapshot, so RETURNING can expose them without a second scan of the destination. */
function updatedReturningSql(target: WritableTargetLayout, captureRevert: boolean): string {
  const columns = [`${targetOf(target, DESTINATION_COLUMN.ID)} AS "id"`];
  if (captureRevert) columns.push(`${plannedOf(PAIR_COLUMN.TARGET_GEOMETRY)} AS "old_geometry"`);
  return columns.join(", ");
}

/* The only writes of the stage: a CHANGED row gets its geometry; a paired row gets type_padron, id_cadastral_locality and number, and its geometry only when updateGeometries is on. id, id_address_master and id_province are never written. */
function updatedRowsCte(target: WritableTargetLayout, options: ActualizarPadronOptions, captureRevert: boolean): string {
  return cte(
    CTE_TARGET.UPDATED,
    [
      `UPDATE ${targetTableSql(target)}`,
      `SET ${physicalColumn(target, DESTINATION_COLUMN.GEOMETRY)} = ${PLANNED_ALIAS}.${q(CANDIDATE_GEOMETRY)}`,
      `FROM ${q(CTE_TARGET.PLANNED)} AS ${PLANNED_ALIAS}`,
      `WHERE ${classIs(MATCH_CLASS.CHANGED)} AND ${applyFlag(options)} AND ${targetOf(target, DESTINATION_COLUMN.ID)} = ${PLANNED_ALIAS}."target_id"`,
      `RETURNING ${updatedReturningSql(target, captureRevert)}`,
    ].join(" ")
  );
}

function pairedReturningSql(target: WritableTargetLayout, captureRevert: boolean): string {
  const columns = [`${targetOf(target, DESTINATION_COLUMN.ID)} AS "id"`];
  if (captureRevert) {
    columns.push(
      `${pairOf(PAIR_COLUMN.OLD_TYPE_PADRON)} AS "old_type_padron"`,
      `${pairOf(PAIR_COLUMN.OLD_LOCALITY_ID)} AS "old_id_cadastral_locality"`,
      `${pairOf(PAIR_COLUMN.OLD_NUMBER)} AS "old_number"`,
      `${pairOf(PAIR_COLUMN.TARGET_GEOMETRY)} AS "old_geometry"`
    );
  }
  return columns.join(", ");
}

function pairedRowsCte(target: WritableTargetLayout, options: ActualizarPadronOptions, captureRevert: boolean): string {
  const assignments = [
    ...PAIRED_KEY_COLUMNS.map((logical) => `${physicalColumn(target, logical)} = ${pairOf(logical)}`),
    `${physicalColumn(target, DESTINATION_COLUMN.GEOMETRY)} = CASE WHEN ${applyFlag(options)} THEN ${pairOf(CANDIDATE_GEOMETRY)} ELSE ${targetOf(target, DESTINATION_COLUMN.GEOMETRY)} END`,
  ];
  return cte(
    CTE_TARGET.PAIRED,
    [
      `UPDATE ${targetTableSql(target)}`,
      `SET ${assignments.join(", ")}`,
      `FROM ${q(CTE_TARGET.PAIRS)} AS ${PAIR_ALIAS}`,
      `WHERE ${appliedCondition()} AND ${targetOf(target, DESTINATION_COLUMN.ID)} = ${pairOf(PAIR_COLUMN.TARGET_ID)}`,
      `RETURNING ${pairedReturningSql(target, captureRevert)}`,
    ].join(" ")
  );
}

/* Writes the old values of every changed row into the session's revert table, before COMMIT. Kinds: U geometry updated, P pair updated, I row inserted. */
function revertRowsCte(): string {
  const [uKind, pKind, iKind] = [REVERT_KIND.UPDATED, REVERT_KIND.PAIRED, REVERT_KIND.INSERTED].map((kind) => literal(kind));
  return cte(
    CTE_TARGET.REVERT,
    [
      `INSERT INTO ${REVERT_TABLE_SQL} (${revertColumnList()})`,
      `SELECT ${uKind}, u."id", NULL, NULL, NULL, u."old_geometry" FROM ${q(CTE_TARGET.UPDATED)} AS u`,
      `UNION ALL SELECT ${pKind}, p."id", p."old_type_padron", p."old_id_cadastral_locality", p."old_number", p."old_geometry" FROM ${q(CTE_TARGET.PAIRED)} AS p`,
      `UNION ALL SELECT ${iKind}, i."id", NULL, NULL, NULL, NULL FROM ${q(CTE_TARGET.INSERTED)} AS i`,
      `RETURNING ${q(REVERT_COLUMN.KIND)}`,
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

function revertCountSql(captureRevert: boolean): string[] {
  return captureRevert ? [`(SELECT count(*) FROM ${q(CTE_TARGET.REVERT)}) AS "revert_rows",`] : [];
}

export function buildPadronApplySql(
  layouts: PadronLayouts,
  options: ActualizarPadronOptions,
  { captureRevert = false }: ApplySqlOptions = {}
): string {
  const { target } = layouts;
  return [
    withClause([
      ...classifyCtes(layouts, options),
      insertedRowsCte(target),
      updatedRowsCte(target, options, captureRevert),
      pairedRowsCte(target, options, captureRevert),
      ...(captureRevert ? [revertRowsCte()] : []),
    ]),
    "SELECT",
    `(SELECT count(*) FROM ${q(CTE_TARGET.INSERTED)}) AS "inserted",`,
    `(SELECT count(*) FROM ${q(CTE_TARGET.UPDATED)}) AS "updated",`,
    `(SELECT count(*) FROM ${q(CTE_TARGET.PAIRED)}) AS "paired",`,
    ...revertCountSql(captureRevert),
    `${jsonArrayOf(INSERTED_LIST_SQL, "inserted_list")} AS "inserted_list"`,
  ].join(" ");
}
