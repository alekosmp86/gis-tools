import { quoteIdentifier, resolveSchemaName } from "@/core/services/sqlStatements";
import { MATCH_CLASS } from "../../shared/geometryCompare";
import { DETAIL_LIST_LIMIT } from "../../shared/limits";
import { cte, literal, q, withClause } from "../../shared/sqlFragments";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import {
  DESTINATION_COLUMN,
  GEOMETRY_TYPE_NAME,
  LOCALITY_COLUMN,
  REFERENCE_POINT_SOURCES,
  PAIR_STATUS,
  PROVINCE_COLUMN,
  RELATION_KIND,
  REPLACEMENT_CLASS,
  REPLACEMENT_CLASS_ORDER,
  REPLACEMENT_COVER_MIN_PCT,
  REPLACEMENT_PARTIAL_MIN_PCT,
  REPLACEMENT_PART_MIN_PCT,
  REPLACEMENT_PARTS_LIMIT,
  REPLACEMENT_REFERENCE_COLUMN,
  STAGING_COLUMN,
  type ReplacementClass,
} from "../constants";
import type { PadronLayouts } from "../types";
import { physicalColumn, qualifiedName } from "./layouts";
import { REASSIGN_BLOCKER, reassignBlockerOf } from "./reassignBlockers";

/** AP-110: the companion table of a referencing table with no geometry of its own; `column` is the join column of the referencing table. */
export interface ReassignCompanion {
  schema: string;
  table: string;
  column: string;
  companionColumn: string;
}

/** AP-110: where the rows of a referencing table can be moved: its single primary key column and the single geometry column that gives the point (its own, or the companion's). */
export interface ReassignTarget {
  pkColumn: string;
  geometryColumn: string;
  geography: boolean;
  companion?: ReassignCompanion;
}

/** AP-110: the point of a row, as SQL over the geometry expression: NULL when missing or empty (AP-111 then uses the largest receiver). */
export function pointOfSql(geometryExpr: string, geography: boolean): string {
  const geometry = geography ? `${geometryExpr}::geometry` : geometryExpr;
  return `CASE WHEN ${geometry} IS NULL OR ST_IsEmpty(${geometry}) THEN NULL WHEN ST_GeometryType(${geometry}) = ${literal("ST_Point")} THEN ${geometry} ELSE ST_PointOnSurface(${geometry}) END`;
}

/** AP-110: the optional LEFT JOIN to the companion (its join column is its single-column primary key, so a row never multiplies) and the geometry expression holding the point. */
export function pointSource(
  { companion, geometryColumn }: ReassignTarget,
  ownAlias: string,
  companionAlias: string
): { join: string; geometry: string } {
  if (companion === undefined) return { join: "", geometry: `${ownAlias}.${q(geometryColumn)}` };
  return {
    join: `LEFT JOIN ${refTableSql(companion.schema, companion.table)} AS ${companionAlias} ON ${companionAlias}.${q(companion.companionColumn)} = ${ownAlias}.${q(companion.column)}`,
    geometry: `${companionAlias}.${q(geometryColumn)}`,
  };
}

/** A table of `cartoSchema`, other than the destination, that AP-102's catalog scan found to carry an `id_padron` column.
    `reassign` is set when AP-110 allows moving its rows; otherwise `reassignBlocker` names why not. */
export interface ReferenceTable {
  schema: string;
  table: string;
  reassign?: ReassignTarget;
  reassignBlocker?: string;
}

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

export const refTableSql = (schema: string, table: string): string =>
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

export const UNPAIRED_NEW_CTE = UNPAIRED;
export const UNPAIRED_NEW_GEOMETRY_COLUMN = NEW_GEOMETRY;
export const MISSING_SCORED_CTE = SCORED;
export const MISSING_SCORED_CLASS_COLUMN = CLASS;

/** The classification of the missing padrones (AP-96), read by the analysis and by the persist classify alike: AP-109 needs the SUBDIVIDED set in both. */
export function classificationCtes(target: WritableTargetLayout): string[] {
  return [
    cte(MISSING, missingAreaSql()),
    cte(UNPAIRED, unpairedNewSql()),
    cte(OVERLAPS, overlapsSql(target)),
    cte(PARTS, partsSql()),
    cte(UNIONS, unionsSql()),
    cte(COVERAGE, coverageSql()),
    cte(SCORED, classifiedSql()),
  ];
}

/** The report-only part of the replacement block: the part labels the analysis lists. */
export const replacementLabelCtes = (): string[] => [cte(LABELS, labelsSql())];

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

export const tableLabelOf = (table: ReferenceTable): string => `${table.schema}.${table.table}`;

const INTEGER_TYPE_NAMES: readonly string[] = ["int2", "int4", "int8", "numeric"];
const integerTypeListSql = (): string => INTEGER_TYPE_NAMES.map((name) => `${literal(name)}::regtype`).join(", ");

/* AP-110: the primary key of the table, counted by the catalog (pg_index.indisprimary). */
const primaryKeyFactsSql = (relation: string, alias: string): string =>
  [
    `CROSS JOIN LATERAL (SELECT count(*) AS pk_columns, min(pa.attname::text) AS pk_column`,
    `FROM pg_catalog.pg_index i JOIN pg_catalog.pg_attribute pa ON pa.attrelid = i.indrelid AND pa.attnum = ANY(i.indkey)`,
    `WHERE i.indrelid = ${relation}.oid AND i.indisprimary AND NOT pa.attisdropped) AS ${alias}`,
  ].join(" ");

/* AP-110: the geometry and geography columns of the table; exactly one is required. */
const geometryFactsSql = (relation: string, alias: string): string =>
  [
    `CROSS JOIN LATERAL (SELECT count(*) AS geometry_columns, min(ga.attname::text) AS geometry_column, min(gt.typname::text) AS geometry_type`,
    `FROM pg_catalog.pg_attribute ga JOIN pg_catalog.pg_type gt ON gt.oid = ga.atttypid`,
    `WHERE ga.attrelid = ${relation}.oid AND ga.attnum > 0 AND NOT ga.attisdropped`,
    `AND gt.typname IN (${Object.values(GEOMETRY_TYPE_NAME).map((name) => literal(name)).join(", ")})) AS ${alias}`,
  ].join(" ");

/* AP-110: the companion of a table with no geometry of its own, from REFERENCE_POINT_SOURCES (constants, never user input) in the same schema; every fact comes from the catalog. */
const pointSourceMappingSql = (): string => {
  const rows = Object.entries(REFERENCE_POINT_SOURCES).map(
    ([table, source]) => `(${literal(table)}, ${literal(source.table)}, ${literal(source.column)}, ${literal(source.companionColumn)})`
  );
  return rows.length === 0
    ? `(SELECT CAST(NULL AS text) AS ref_table, CAST(NULL AS text) AS companion_table, CAST(NULL AS text) AS ref_column, CAST(NULL AS text) AS companion_column WHERE false) AS pm`
    : `(VALUES ${rows.join(", ")}) AS pm(ref_table, companion_table, ref_column, companion_column)`;
};

const columnCountSql = (relation: string, column: string): string =>
  `(SELECT count(*) FROM pg_catalog.pg_attribute ja WHERE ja.attrelid = ${relation}.oid AND ja.attname = ${column} AND ja.attnum > 0 AND NOT ja.attisdropped)`;

const companionFactsSql = (): string =>
  [
    `LEFT JOIN ${pointSourceMappingSql()} ON pm.ref_table = c.relname::text`,
    `LEFT JOIN pg_catalog.pg_class c2 ON c2.relnamespace = n.oid AND c2.relname = pm.companion_table`,
    `AND c2.relkind IN (${literal(RELATION_KIND.TABLE)}, ${literal(RELATION_KIND.PARTITIONED)})`,
    primaryKeyFactsSql("c2", "pk2"),
    geometryFactsSql("c2", "geo2"),
  ].join(" ");

const companionColumnsSql = (): string =>
  [
    `pm.companion_table AS ${q("companion_table")}, pm.companion_column AS ${q("companion_column")}, pm.ref_column AS ${q("companion_ref_column")},`,
    `pk2.pk_columns AS ${q("companion_pk_columns")}, pk2.pk_column AS ${q("companion_pk_column")},`,
    `geo2.geometry_columns AS ${q("companion_geometry_columns")}, geo2.geometry_column AS ${q("companion_geometry_column")}, geo2.geometry_type AS ${q("companion_geometry_type")},`,
    `CASE WHEN c2.oid IS NULL THEN false ELSE has_table_privilege(c2.oid, 'SELECT') END AS ${q("companion_readable")},`,
    `CASE WHEN c2.oid IS NULL THEN 0 ELSE ${columnCountSql("c", "pm.ref_column")} + ${columnCountSql("c2", "pm.companion_column")} END AS ${q("companion_join_columns")}`,
  ].join(" ");

/** AP-102: every table of `cartoSchema`, other than the destination, that carries a numeric `id_padron` column; `schema` is
    always bound, never a literal. The type filter matters: without it, a same-named non-numeric column would make the
    reference count query below throw a type mismatch. `readable` is the role's SELECT privilege on that column: a table it
    cannot read is never counted as zero references, it blocks the deletion (AP-102). */
export function referenceTablesScanSql(schema: string, excludedTable: string): string {
  return [
    `SELECT n.nspname AS ${q("schema")}, c.relname AS ${q("table")},`,
    `has_column_privilege(c.oid, a.attnum, 'SELECT') AS ${q("readable")},`,
    `has_column_privilege(c.oid, a.attnum, 'UPDATE') AS ${q("updatable")},`,
    `pk.pk_columns AS ${q("pk_columns")}, pk.pk_column AS ${q("pk_column")},`,
    `geo.geometry_columns AS ${q("geometry_columns")}, geo.geometry_column AS ${q("geometry_column")}, geo.geometry_type AS ${q("geometry_type")},`,
    companionColumnsSql(),
    `FROM pg_catalog.pg_class c`,
    `JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace`,
    `JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid`,
    primaryKeyFactsSql("c", "pk"),
    geometryFactsSql("c", "geo"),
    companionFactsSql(),
    `WHERE n.nspname = ${literal(schema)}`,
    `AND c.relkind IN (${literal(RELATION_KIND.TABLE)}, ${literal(RELATION_KIND.PARTITIONED)})`,
    `AND c.relname <> ${literal(excludedTable)}`,
    `AND a.attname = ${literal(REPLACEMENT_REFERENCE_COLUMN)}`,
    `AND a.attnum > 0 AND NOT a.attisdropped`,
    `AND a.atttypid IN (${integerTypeListSql()})`,
    `ORDER BY 1, 2`,
  ].join(" ");
}

/* One grouped aggregate per discovered table, over the ids of idsCte (column idColumn): one scan per table, never one per listed row.
   Only readable tables are given here (AP-102): a table with no rows contributes nothing for that id. */
/* AP-110: why the rows of this table cannot be moved: a fixed reason of the table. A row without a usable point never blocks (AP-111). NULL means they can. */
function blockReasonSql(table: ReferenceTable): string {
  return `CAST(${table.reassign === undefined ? literal(reassignBlockerOf(table) ?? REASSIGN_BLOCKER.NO_PRIMARY_KEY) : "NULL"} AS text)`;
}

/* AP-111: the rows of this padrón and table that have no usable point and go to the largest receiver. */
function noPointCountSql(table: ReferenceTable, alias: string): string {
  const { reassign } = table;
  if (reassign === undefined) return `CAST(0 AS bigint)`;
  const { geometry } = pointSource(reassign, alias, `${alias}c`);
  return `count(*) FILTER (WHERE ${pointOfSql(geometry, reassign.geography)} IS NULL)`;
}

function referenceRawSql(idsCte: string, idColumn: string, tables: readonly ReferenceTable[]): string {
  if (tables.length === 0) {
    return `SELECT CAST(NULL AS integer) AS "old_id", CAST(NULL AS text) AS "table_label", CAST(NULL AS bigint) AS "refs", CAST(NULL AS text) AS "block_reason", CAST(NULL AS bigint) AS "no_point" WHERE false`;
  }
  return tables
    .map((table, index) => {
      const alias = `rt${index}`;
      const idColumnSql = `${alias}.${q(REPLACEMENT_REFERENCE_COLUMN)}`;
      const join = table.reassign === undefined ? "" : pointSource(table.reassign, alias, `${alias}c`).join;
      return [
        `SELECT ${idColumnSql} AS "old_id", ${literal(tableLabelOf(table))} AS "table_label", count(*) AS "refs", ${blockReasonSql(table)} AS "block_reason", ${noPointCountSql(table, alias)} AS "no_point"`,
        `FROM ${refTableSql(table.schema, table.table)} AS ${alias} ${join}`,
        `WHERE ${idColumnSql} IN (SELECT ${q(idColumn)} FROM ${q(idsCte)})`,
        `GROUP BY ${idColumnSql}`,
      ].join(" ");
    })
    .join(" UNION ALL ");
}

const referenceAggSql = (rawName: string): string =>
  [
    `SELECT "old_id", sum("refs") AS "total", json_object_agg("table_label", "refs") AS "by_table",`,
    `count("block_reason") AS "blocked",`,
    `COALESCE(json_object_agg("table_label", "block_reason") FILTER (WHERE "block_reason" IS NOT NULL), '{}'::json) AS "blockers"`,
    `FROM ${q(rawName)} GROUP BY "old_id"`,
  ].join(" ");

/** The two CTEs of a reference-count block: the per-table raw counts over `idsCte`, then one row per id with its total and its per-table counts. Shared by AP-103's eligibility refs (every missing padrón) and AP-106's staleness re-check. */
export const referenceRawName = (name: string): string => `${name}_raw`;

export function referenceCountCtes(name: string, idsCte: string, idColumn: string, tables: readonly ReferenceTable[]): string[] {
  const rawName = referenceRawName(name);
  return [cte(rawName, referenceRawSql(idsCte, idColumn, tables)), cte(name, referenceAggSql(rawName))];
}

export const referenceJoinSql = (name: string, idExpr: string): string => `LEFT JOIN ${q(name)} ON ${q(name)}."old_id" = ${idExpr}`;
export const referenceTotalColumnSql = (name: string): string => `COALESCE(${q(name)}."total", 0)`;
const referenceByTableColumnSql = (name: string): string => `COALESCE(${q(name)}."by_table", '{}'::json)`;
export const referenceBlockedColumnSql = (name: string): string => `COALESCE(${q(name)}."blocked", 0)`;
const referenceBlockersColumnSql = (name: string): string => `COALESCE(${q(name)}."blockers", '{}'::json)`;

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

/** The classify chain's removal CTEs that the missing review reads: the reference counts (AP-102) and the removal reason (AP-103) of every missing padrón. */
export const REMOVAL_CTE = {
  REFS: "removal_refs",
  VERDICTS: "removal_verdicts",
} as const;

const VERDICT_ALIAS = "rv";

/** The listed missing padrones, capped at DETAIL_LIST_LIMIT. The centroid is read for the listed rows only; the references and the removal reason come from the classify chain. */
export function missingReviewSql(layouts: PadronLayouts): string {
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
    `${referenceTotalColumnSql(REMOVAL_CTE.REFS)} AS "refsTotal"`,
    `${referenceByTableColumnSql(REMOVAL_CTE.REFS)} AS "refsByTable"`,
    `${referenceBlockersColumnSql(REMOVAL_CTE.REFS)} AS "reassignBlockers"`,
    `${VERDICT_ALIAS}."reason" AS "removalReason"`,
  ];
  return [
    withClause([cte(LISTED, listedSql(layouts))]),
    `SELECT ${columns.join(", ")} FROM ${q(LISTED)}`,
    referenceJoinSql(REMOVAL_CTE.REFS, `${LISTED}."oldId"`),
    `LEFT JOIN ${q(REMOVAL_CTE.VERDICTS)} AS ${VERDICT_ALIAS} ON ${VERDICT_ALIAS}."old_id" = ${LISTED}."oldId"`,
    `ORDER BY ${LISTED}.${q(CLASS_RANK)}, ${LISTED}."department", ${LISTED}."locality", ${LISTED}."number"`,
  ].join(" ");
}
