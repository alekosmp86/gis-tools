import { quoteIdentifier, resolveSchemaName } from "@/core/services/sqlStatements";
import { MATCH_CLASS } from "../../shared/geometryCompare";
import { DETAIL_LIST_LIMIT } from "../../shared/limits";
import { cte, literal, q, withClause } from "../../shared/sqlFragments";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import {
  DESTINATION_COLUMN,
  LOCALITY_COLUMN,
  PAIR_STATUS,
  PROVINCE_COLUMN,
  REPLACEMENT_CLASS,
  REPLACEMENT_CLASS_ORDER,
  REPLACEMENT_COVER_MIN_PCT,
  REPLACEMENT_PARTIAL_MIN_PCT,
  REPLACEMENT_PART_MIN_PCT,
  REPLACEMENT_PARTS_LIMIT,
  REPLACEMENT_REFERENCE_COLUMN,
  REPLACEMENT_REFERENCE_TABLE,
  STAGING_COLUMN,
  type ReplacementClass,
} from "../constants";
import type { PadronLayouts } from "../types";
import { physicalColumn, qualifiedName } from "./layouts";

export interface ReferenceTableFlags {
  accessPoint: boolean;
  addresses: boolean;
}

export const NO_REFERENCE_TABLES: ReferenceTableFlags = { accessPoint: false, addresses: false };

/* Names of the classify statement's CTEs that the replacement block reads. */
const SOURCE = {
  UNMATCHED: "unmatched_targets",
  PLANNED: "planned",
  PAIRS: "pairs",
} as const;

const MISSING = "missing_old";
const UNPAIRED = "unpaired_new";
const OVERLAPS = "replacement_overlaps";
const PARTS = "replacement_parts";
const UNIONS = "replacement_union";
const COVERAGE = "missing_coverage";
const SCORED = "missing_scored";
const LABELS = "replacement_labels";

const OLD_GEOMETRY = "old_geometry";
const OLD_AREA = "old_area";
const NEW_GEOMETRY = "new_geometry";
const OVERLAP = "overlap";
const PART_PCT = "part_pct";
const PART_COUNT = "part_count";
const BEST_PCT = "best_pct";
const UNION_GEOMETRY = "union_geometry";
const COVERED_PCT = "covered_pct";
const CLASS = "class";
const CLASS_RANK = "class_rank";
const LABEL = "label";
const LOCALITY = "locality";
const RANK = "rank";
const WGS84_SRID = 4326;

const COUNT_COLUMN: Record<ReplacementClass, string> = {
  [REPLACEMENT_CLASS.SUBDIVIDED]: "missing_subdivided",
  [REPLACEMENT_CLASS.REPLACED_ONE]: "missing_replaced_one",
  [REPLACEMENT_CLASS.PARTIAL]: "missing_partial",
  [REPLACEMENT_CLASS.ORPHAN]: "missing_orphan",
};

const col = (alias: string, column: string): string => `${alias}.${q(column)}`;

const refTableSql = (schema: string, table: string): string =>
  `${quoteIdentifier(resolveSchemaName(schema))}.${quoteIdentifier(table)}`;

/* Destination rows that no staging row carries and no applied pair claims. An invalid geometry reads as NULL: it can be listed, never overlaid. */
function missingOldSql(): string {
  const geometry = col("ut", DESTINATION_COLUMN.GEOMETRY);
  const columns = [
    col("ut", DESTINATION_COLUMN.ID),
    col("ut", DESTINATION_COLUMN.TYPE_PADRON),
    col("ut", DESTINATION_COLUMN.ID_PROVINCE),
    col("ut", DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY),
    col("ut", DESTINATION_COLUMN.NUMBER),
    `CASE WHEN ST_IsValid(${geometry}) THEN ${geometry} END AS ${q(OLD_GEOMETRY)}`,
  ];
  return [
    `SELECT ${columns.join(", ")} FROM ${q(SOURCE.UNMATCHED)} AS ut`,
    `WHERE NOT EXISTS (SELECT 1 FROM ${q(SOURCE.PAIRS)} AS pr WHERE ${col("pr", "status")} = ${literal(PAIR_STATUS.APPLIED)}`,
    `AND ${col("pr", "target_id")} = ${col("ut", DESTINATION_COLUMN.ID)})`,
  ].join(" ");
}

function missingAreaSql(): string {
  return `SELECT g.*, ST_Area(g.${q(OLD_GEOMETRY)}) AS ${q(OLD_AREA)} FROM (${missingOldSql()}) AS g`;
}

/* New padrones that no applied pair consumes: the ones a replacement can come from. */
function unpairedNewSql(): string {
  const newKey = (column: string): string => col("pl", column);
  const pairKey = (column: string): string => col("pr", column);
  return [
    `SELECT ${newKey(DESTINATION_COLUMN.ID_PROVINCE)}, ${newKey(DESTINATION_COLUMN.TYPE_PADRON)}, ${newKey(DESTINATION_COLUMN.NUMBER)},`,
    `${newKey("candidate_geometry")} AS ${q(NEW_GEOMETRY)}, ${newKey(STAGING_COLUMN.NOMLOCCAT)} AS ${q(LOCALITY)}`,
    `FROM ${q(SOURCE.PLANNED)} AS pl`,
    `WHERE ${newKey("class")} = ${literal(MATCH_CLASS.NEW)} AND ST_IsValid(${newKey("candidate_geometry")})`,
    `AND NOT EXISTS (SELECT 1 FROM ${q(SOURCE.PAIRS)} AS pr WHERE ${pairKey("status")} = ${literal(PAIR_STATUS.APPLIED)}`,
    `AND ${pairKey(DESTINATION_COLUMN.TYPE_PADRON)} = ${newKey(DESTINATION_COLUMN.TYPE_PADRON)}`,
    `AND ${pairKey(DESTINATION_COLUMN.ID_PROVINCE)} = ${newKey(DESTINATION_COLUMN.ID_PROVINCE)}`,
    `AND ${pairKey(DESTINATION_COLUMN.NUMBER)} = ${newKey(DESTINATION_COLUMN.NUMBER)}`,
    `AND ${pairKey(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)} IS NOT DISTINCT FROM ${newKey(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)})`,
  ].join(" ");
}

/* The footprint overlap of each missing padrón with each new padrón of its province whose bounding box meets it. The probe drives from
   the destination's GiST index (one bounding-box lookup per new padrón), then joins the missing rows by id. OFFSET 0 fences the
   intersection so the planner computes it once per pair, not once per reference. */
function overlapsSql(target: WritableTargetLayout): string {
  const old = (column: string): string => col("mo", column);
  const incoming = (column: string): string => col("n", column);
  const targetColumn = (logical: string): string => `tgt.${physicalColumn(target, logical)}`;
  return [
    `SELECT ${old(DESTINATION_COLUMN.ID)} AS "old_id", ${old(OLD_AREA)}, ${old(OLD_GEOMETRY)},`,
    `${incoming(DESTINATION_COLUMN.TYPE_PADRON)}, ${incoming(DESTINATION_COLUMN.NUMBER)}, ${incoming(LOCALITY)}, ${incoming(NEW_GEOMETRY)}, ${col("ov", OVERLAP)}`,
    `FROM ${q(UNPAIRED)} AS n JOIN ${qualifiedName(target)} AS tgt`,
    `ON ${targetColumn(DESTINATION_COLUMN.GEOMETRY)} && ${incoming(NEW_GEOMETRY)} AND ${targetColumn(DESTINATION_COLUMN.ID_PROVINCE)} = ${incoming(DESTINATION_COLUMN.ID_PROVINCE)}`,
    `JOIN ${q(MISSING)} AS mo ON ${old(DESTINATION_COLUMN.ID)} = ${targetColumn(DESTINATION_COLUMN.ID)}`,
    `CROSS JOIN LATERAL (SELECT ST_Area(ST_Intersection(${old(OLD_GEOMETRY)}, ${incoming(NEW_GEOMETRY)})) AS ${q(OVERLAP)} OFFSET 0) AS ov`,
    `WHERE ${col("ov", OVERLAP)} > 0`,
  ].join(" ");
}

/* Only the new padrones that cover at least REPLACEMENT_PART_MIN_PCT of the missing area take part: the slivers of a neighbour do not. */
function partsSql(): string {
  const partPct = `${col("o", OVERLAP)} * 100.0 / NULLIF(${col("o", OLD_AREA)}, 0)`;
  return [
    `SELECT ${col("p", "old_id")}, ${col("p", DESTINATION_COLUMN.TYPE_PADRON)}, ${col("p", DESTINATION_COLUMN.NUMBER)}, ${col("p", LOCALITY)},`,
    `${col("p", NEW_GEOMETRY)}, ${col("p", PART_PCT)}`,
    `FROM (SELECT ${col("o", "old_id")}, ${col("o", DESTINATION_COLUMN.TYPE_PADRON)}, ${col("o", DESTINATION_COLUMN.NUMBER)}, ${col("o", LOCALITY)},`,
    `${col("o", NEW_GEOMETRY)}, ${partPct} AS ${q(PART_PCT)}`,
    `FROM ${q(OVERLAPS)} AS o) AS p`,
    `WHERE ${col("p", PART_PCT)} >= ${REPLACEMENT_PART_MIN_PCT}`,
  ].join(" ");
}

function unionsSql(): string {
  return [
    `SELECT ${col("p", "old_id")}, count(*) AS ${q(PART_COUNT)}, max(${col("p", PART_PCT)}) AS ${q(BEST_PCT)},`,
    `ST_Union(${col("p", NEW_GEOMETRY)}) AS ${q(UNION_GEOMETRY)}`,
    `FROM ${q(PARTS)} AS p GROUP BY ${col("p", "old_id")}`,
  ].join(" ");
}

/* The covered share is the intersection of the old footprint with the union of its parts, over the old area. */
function coverageSql(): string {
  const old = (column: string): string => col("mo", column);
  const union = (column: string): string => col("u", column);
  const coveredArea = `ST_Area(ST_Intersection(${old(OLD_GEOMETRY)}, ${union(UNION_GEOMETRY)}))`;
  return [
    `SELECT ${old(DESTINATION_COLUMN.ID)}, ${old(DESTINATION_COLUMN.TYPE_PADRON)}, ${old(DESTINATION_COLUMN.ID_PROVINCE)},`,
    `${old(DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)}, ${old(DESTINATION_COLUMN.NUMBER)}, ${old(OLD_GEOMETRY)}, ${old(OLD_AREA)},`,
    `${union(PART_COUNT)}, ${union(BEST_PCT)},`,
    `CASE WHEN ${union(UNION_GEOMETRY)} IS NOT NULL AND ${old(OLD_AREA)} > 0 THEN ${coveredArea} * 100 / ${old(OLD_AREA)} END AS ${q(COVERED_PCT)}`,
    `FROM ${q(MISSING)} AS mo LEFT JOIN ${q(UNIONS)} AS u ON ${union("old_id")} = ${old(DESTINATION_COLUMN.ID)}`,
  ].join(" ");
}

/* The order of the tests is the class: a single large cover wins over a subdivision; a partial cover needs at least PARTIAL_MIN. */
function classifiedSql(): string {
  const score = (column: string): string => col("c", column);
  const classSql = [
    "CASE",
    `WHEN ${score(BEST_PCT)} >= ${REPLACEMENT_COVER_MIN_PCT} THEN ${literal(REPLACEMENT_CLASS.REPLACED_ONE)}`,
    `WHEN ${score(PART_COUNT)} >= 2 AND ${score(COVERED_PCT)} >= ${REPLACEMENT_COVER_MIN_PCT} THEN ${literal(REPLACEMENT_CLASS.SUBDIVIDED)}`,
    `WHEN ${score(COVERED_PCT)} >= ${REPLACEMENT_PARTIAL_MIN_PCT} THEN ${literal(REPLACEMENT_CLASS.PARTIAL)}`,
    `ELSE ${literal(REPLACEMENT_CLASS.ORPHAN)} END AS ${q(CLASS)}`,
  ].join(" ");
  return `SELECT c.*, ${classSql} FROM ${q(COVERAGE)} AS c`;
}

/* One row per listed part, largest cover first: the label for the report and the staging key the map reads back. */
function labelsSql(): string {
  const ranked = [
    `SELECT ${col("r", "old_id")}, ${col("r", PART_PCT)}, ${col("r", DESTINATION_COLUMN.TYPE_PADRON)}, ${col("r", DESTINATION_COLUMN.NUMBER)}, ${col("r", LOCALITY)},`,
    `concat_ws(' ', ${col("r", DESTINATION_COLUMN.TYPE_PADRON)}, ${col("r", DESTINATION_COLUMN.NUMBER)}) || ' (' || round(${col("r", PART_PCT)}::numeric, 1) || ' %)' AS ${q(LABEL)},`,
    `row_number() OVER (PARTITION BY ${col("r", "old_id")} ORDER BY ${col("r", PART_PCT)} DESC) AS ${q(RANK)}`,
    `FROM ${q(PARTS)} AS r`,
  ].join(" ");
  const ordered = `ORDER BY ${col("l", PART_PCT)} DESC`;
  return [
    `SELECT ${col("l", "old_id")}, json_agg(${col("l", LABEL)} ${ordered}) AS ${q("parts")},`,
    `json_agg(json_build_object('typePadron', ${col("l", DESTINATION_COLUMN.TYPE_PADRON)}, 'number', ${col("l", DESTINATION_COLUMN.NUMBER)}, 'locality', ${col("l", LOCALITY)}) ${ordered}) AS ${q("partKeys")}`,
    `FROM (${ranked}) AS l WHERE ${col("l", RANK)} <= ${REPLACEMENT_PARTS_LIMIT} GROUP BY ${col("l", "old_id")}`,
  ].join(" ");
}

/** The CTEs of the replacement block; they follow the classify chain in the same WITH and read only its CTEs. */
export function replacementCtes(target: WritableTargetLayout): string[] {
  return [
    cte(MISSING, missingAreaSql()),
    cte(UNPAIRED, unpairedNewSql()),
    cte(OVERLAPS, overlapsSql(target)),
    cte(PARTS, partsSql()),
    cte(UNIONS, unionsSql()),
    cte(COVERAGE, coverageSql()),
    cte(SCORED, classifiedSql()),
    cte(LABELS, labelsSql()),
  ];
}

/** Exact counts per class over every missing padrón, not only the listed ones. */
export function replacementCountSql(): string {
  return REPLACEMENT_CLASS_ORDER.map(
    (replacementClass) =>
      `(SELECT count(*) FROM ${q(SCORED)} AS sc WHERE ${col("sc", CLASS)} = ${literal(replacementClass)}) AS ${q(COUNT_COLUMN[replacementClass])}`
  ).join(", ");
}

const classRankSql = (classColumn: string): string =>
  [
    `CASE ${classColumn}`,
    ...REPLACEMENT_CLASS_ORDER.map((replacementClass, index) => `WHEN ${literal(replacementClass)} THEN ${index + 1}`),
    `ELSE ${REPLACEMENT_CLASS_ORDER.length + 1} END`,
  ].join(" ");

const LISTED = "listed";
const LISTED_OLD_ID = `${q(LISTED)}."oldId"`;
const REFERENCE_COUNT_COLUMN = "refs";

interface ReferenceCountSource {
  flag: keyof ReferenceTableFlags;
  table: string;
  column: string;
  cte: string;
}

/* The reference counts exist only for the tables the carto schema has, readable and carrying a numeric id_padron column. */
const REFERENCE_COUNT_SOURCES: readonly ReferenceCountSource[] = [
  { flag: "accessPoint", table: REPLACEMENT_REFERENCE_TABLE.ACCESS_POINT, column: "accessPointRefs", cte: "access_point_refs" },
  { flag: "addresses", table: REPLACEMENT_REFERENCE_TABLE.ADDRESSES, column: "addressesRefs", cte: "addresses_refs" },
];

const referenceSourcesOf = (references: ReferenceTableFlags): ReferenceCountSource[] =>
  REFERENCE_COUNT_SOURCES.filter((source) => references[source.flag]);

/* One grouped aggregate per reference table over the listed old ids: one sequential scan per table, never one per listed row. */
function referenceCountCte(schema: string, source: ReferenceCountSource): string {
  const idColumn = q(REPLACEMENT_REFERENCE_COLUMN);
  return cte(
    source.cte,
    [
      `SELECT ar.${idColumn} AS ${idColumn}, count(*) AS ${q(REFERENCE_COUNT_COLUMN)}`,
      `FROM ${refTableSql(schema, source.table)} AS ar`,
      `WHERE ar.${idColumn} IN (SELECT ${LISTED_OLD_ID} FROM ${q(LISTED)})`,
      `GROUP BY ar.${idColumn}`,
    ].join(" ")
  );
}

const referenceJoinSql = (source: ReferenceCountSource): string =>
  `LEFT JOIN ${q(source.cte)} ON ${q(source.cte)}.${q(REPLACEMENT_REFERENCE_COLUMN)} = ${LISTED_OLD_ID}`;

const referenceColumnSql = (source: ReferenceCountSource): string =>
  `COALESCE(${q(source.cte)}.${q(REFERENCE_COUNT_COLUMN)}, 0) AS ${q(source.column)}`;

function listedSql({ province, locality }: PadronLayouts): string {
  const provinceName = `${q("prov")}.${physicalColumn(province, PROVINCE_COLUMN.NAME)}`;
  const localityName = `${q("loc")}.${physicalColumn(locality, LOCALITY_COLUMN.NAME)}`;
  const columns = [
    `${col("sc", DESTINATION_COLUMN.ID)} AS "oldId"`,
    `${col("sc", DESTINATION_COLUMN.TYPE_PADRON)} AS "typePadron"`,
    `${col("sc", DESTINATION_COLUMN.ID_PROVINCE)} AS "provinceId"`,
    `${provinceName} AS "department"`,
    `${localityName} AS "locality"`,
    `${col("sc", DESTINATION_COLUMN.NUMBER)} AS "number"`,
    `${col("sc", OLD_AREA)} AS "oldArea"`,
    `${col("sc", OLD_GEOMETRY)} AS "oldGeometry"`,
    `${col("sc", CLASS)} AS "class"`,
    `${col("sc", COVERED_PCT)} AS "coveredPct"`,
    `COALESCE(${col("lb", "parts")}, '[]'::json) AS "parts"`,
    `COALESCE(${col("lb", "partKeys")}, '[]'::json) AS "partKeys"`,
    `${classRankSql(col("sc", CLASS))} AS ${q(CLASS_RANK)}`,
  ];
  return [
    `SELECT ${columns.join(", ")} FROM ${q(SCORED)} AS sc`,
    `LEFT JOIN ${qualifiedName(province)} AS ${q("prov")} ON ${q("prov")}.${physicalColumn(province, PROVINCE_COLUMN.ID)} = ${col("sc", DESTINATION_COLUMN.ID_PROVINCE)}`,
    `LEFT JOIN ${qualifiedName(locality)} AS ${q("loc")} ON ${q("loc")}.${physicalColumn(locality, LOCALITY_COLUMN.ID)} = ${col("sc", DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY)}`,
    `LEFT JOIN ${q(LABELS)} AS ${q("lb")} ON ${col("lb", "old_id")} = ${col("sc", DESTINATION_COLUMN.ID)}`,
    `ORDER BY ${q(CLASS_RANK)}, ${q("department")}, ${q("locality")}, ${q("number")} LIMIT ${DETAIL_LIST_LIMIT}`,
  ].join(" ");
}

/** The listed missing padrones, capped at DETAIL_LIST_LIMIT. The centroid and the reference counts are read for the listed rows only. */
export function missingReviewSql(layouts: PadronLayouts, references: ReferenceTableFlags): string {
  const sources = referenceSourcesOf(references);
  const centroid = `ST_Transform(ST_Centroid(${LISTED}."oldGeometry"), ${WGS84_SRID})`;
  const columns = [
    `${LISTED}."oldId"`,
    `${LISTED}."typePadron"`,
    `${LISTED}."provinceId"`,
    `${LISTED}."department"`,
    `${LISTED}."locality"`,
    `${LISTED}."number"`,
    `ROUND(CAST(${LISTED}."oldArea" AS numeric), 1) AS "oldAreaM2"`,
    `ROUND(CAST(ST_Y(${centroid}) AS numeric), 6) AS "centroidLat"`,
    `ROUND(CAST(ST_X(${centroid}) AS numeric), 6) AS "centroidLon"`,
    `${LISTED}."class"`,
    `ROUND(CAST(${LISTED}."coveredPct" AS numeric), 1) AS "coveredPct"`,
    `${LISTED}."parts"`,
    `${LISTED}."partKeys"`,
    ...sources.map(referenceColumnSql),
  ];
  return [
    withClause([cte(LISTED, listedSql(layouts)), ...sources.map((source) => referenceCountCte(layouts.target.schema, source))]),
    `SELECT ${columns.join(", ")} FROM ${q(LISTED)}`,
    ...sources.map(referenceJoinSql),
    `ORDER BY ${LISTED}.${q(CLASS_RANK)}, ${LISTED}."department", ${LISTED}."locality", ${LISTED}."number"`,
  ].join(" ");
}

const INTEGER_TYPE_NAMES: readonly string[] = ["int2", "int4", "int8", "numeric"];
const integerTypeListSql = (): string => INTEGER_TYPE_NAMES.map((name) => `${literal(name)}::regtype`).join(", ");

/** The probe reads the catalog only: a missing table, a missing or non-numeric id_padron column or a missing privilege answers false, never an error. */
export function referenceTablesProbeSql(schema: string): string {
  const flag = (table: string): string => {
    const regclass = `to_regclass(${literal(refTableSql(schema, table))})`;
    return [
      `(${regclass} IS NOT NULL AND has_table_privilege(${regclass}, 'SELECT') AND EXISTS (`,
      `SELECT 1 FROM pg_attribute WHERE attrelid = ${regclass} AND attname = ${literal(REPLACEMENT_REFERENCE_COLUMN)} AND NOT attisdropped`,
      `AND atttypid IN (${integerTypeListSql()})))`,
    ].join(" ");
  };
  return `SELECT ${flag(REPLACEMENT_REFERENCE_TABLE.ACCESS_POINT)} AS "accessPoint", ${flag(REPLACEMENT_REFERENCE_TABLE.ADDRESSES)} AS "addresses"`;
}
