import { cte, q, withClause } from "../../shared/sqlFragments";
import {
  ACCESS_POINT_COLUMN,
  CIRCULATION_WAY_COLUMN,
  COVERAGE_RATIO,
  COVERAGE_TOLERANCE_M,
  DEPARTMENTS_COLUMN,
  GEOMETRY_EQUALITY_DECIMALS,
  GEOMETRY_TOLERANCE_M,
  LOCALITIES_COLUMN,
  ROAD_SECTION_COLUMN,
  EJES_STAGING_COLUMN,
  EJES_TABLE_ROLE,
} from "../constants";
import type { EjesLayouts, EjesLoadContext } from "../types";
import { integerColumnOf, physicalOf } from "./loadContext";
import { col, countOf, listOf, table, trimmed } from "./layoutSql";
import { FUENTE_MAP_CTE_NAME, fuenteMapCte, TIPO_MAP_CTE_NAME, tipoMapCte } from "./mappings";
import { canonicalTextSql, INTEGER_PATTERN, validGeometrySql } from "./stagingSql";
import {
  renumberCountColumns,
  renumberCtes,
  renumberListColumn,
  renumberSinkCtes,
  renumberSkippedListColumn,
  type RenumberSinks,
} from "./renumberSql";
import { isPieceSql } from "./pieceSql";
import { groupPieceCtes, removalSinkCtes, type RemovalSinks } from "./removalSql";
import { reviewPointCtes, reviewPointsColumn, splitPointCountColumns, splitPointCtes, splitPointSinkCtes } from "./splitPointSql";
import { twinCountColumns, twinCtes, twinGroupCtes, twinListColumn } from "./twinSql";

const SNAP_GRID = 10 ** -GEOMETRY_EQUALITY_DECIMALS;

export type AnalysisSinks = RenumberSinks & RemovalSinks;

export const ANALYSIS_LIST_ALIAS = {
  SPLITS: "splits_json",
  MERGES: "merges_json",
  PLAIN: "plain_json",
  STREETS: "streets_json",
  ATTRS: "attrs_json",
  TWINS: "twins_json",
  RENUMBERED: "renumbered_json",
  RENUMBER_SKIPPED: "renumber_skipped_json",
} as const;

export const comparableLineSql = (geometry: string): string =>
  `ST_Normalize(ST_SnapToGrid(ST_LineMerge(${geometry}), ${SNAP_GRID}))`;

/** A coordinate that rounds to the other side of the snap grid is noise: the Hausdorff distance is read only for pairs the ordering test calls different. */
export const geometriesDifferSql = (current: string, incoming: string): string =>
  `NOT CASE WHEN COALESCE(ST_OrderingEquals(${comparableLineSql(current)}, ${comparableLineSql(incoming)}), false) THEN true ELSE COALESCE(ST_HausdorffDistance(${current}, ${incoming}) < ${GEOMETRY_TOLERANCE_M}, false) END`;

export const coverageThresholdSql = (covered: string, length: string): string =>
  `${covered} >= ${COVERAGE_RATIO} * ${length}`;

/** The `reftramo` of an access point, in the same canonical form as the sections it points to. */
const accessPointRefSql = (layouts: EjesLayouts): string =>
  canonicalTextSql(`a.${col(layouts, "ACCESS_POINT", ACCESS_POINT_COLUMN.ROAD_SECTION)}`);

const CANONICAL_INTEGER_TEXT = "^(0|-?[1-9][0-9]*)$";

/**
 * Matches an access point's `reftramo` to a canonical text `value` (see `accessPointRefSql`). An integer column is compared by value,
 * so its index applies; a canonical text that is not an integer in the column's range matches no point. Other columns keep the text.
 */
export function accessPointRefMatchSql(context: EjesLoadContext, value: string): string {
  const column = physicalOf(context, EJES_TABLE_ROLE.ACCESS_POINT, ACCESS_POINT_COLUMN.ROAD_SECTION);
  const integer = integerColumnOf(context, EJES_TABLE_ROLE.ACCESS_POINT, ACCESS_POINT_COLUMN.ROAD_SECTION);
  if (integer === undefined) return `${canonicalTextSql(`a.${column}`)} = ${value}`;
  const inRange = `CASE WHEN ${value}::numeric BETWEEN ${integer.min} AND ${integer.max} THEN ${value}::${integer.type} END`;
  return `a.${column} = CASE WHEN ${value} ~ '${CANONICAL_INTEGER_TEXT}' THEN (${inRange}) END`;
}

function stagingCtes(layouts: EjesLayouts): string[] {
  const staging = table(layouts, "STAGING");
  const column = (logical: string): string => `s.${col(layouts, "STAGING", logical)}`;
  const reference = canonicalTextSql(column(EJES_STAGING_COLUMN.REFTRAMO));
  const street = canonicalTextSql(column(EJES_STAGING_COLUMN.IDCALLE));
  const geometry = column(EJES_STAGING_COLUMN.GEOM);
  return [
    cte("stg_keys", `SELECT DISTINCT ${reference} AS ref FROM ${staging} AS s WHERE ${reference} IS NOT NULL`),
    cte(
      "stg",
      [
        "SELECT DISTINCT ON (raw.ref) raw.* FROM (SELECT",
        `${reference} AS ref,`,
        `${street} AS idcalle,`,
        `${trimmed(column(EJES_STAGING_COLUMN.NOMBRE))} AS nombre,`,
        `${trimmed(column(EJES_STAGING_COLUMN.TIPO_VIALIDAD))} AS tipo,`,
        `${trimmed(column(EJES_STAGING_COLUMN.FUENTE))} AS fuente,`,
        `${trimmed(column(EJES_STAGING_COLUMN.DEPARTAMENTO))} AS departamento,`,
        `${trimmed(column(EJES_STAGING_COLUMN.LOCALIDAD))} AS localidad,`,
        `${geometry} AS geom`,
        `FROM ${staging} AS s WHERE ${geometry} IS NOT NULL AND NOT ST_IsEmpty(${geometry}) AND ${validGeometrySql(geometry)}`,
        `AND ${reference} ~ '${INTEGER_PATTERN}') AS raw`,
        "ORDER BY raw.ref, raw.idcalle, raw.nombre, raw.tipo, raw.fuente, raw.departamento, raw.localidad, ST_AsEWKB(raw.geom)",
      ].join(" ")
    ),
  ];
}

/** Row count and md5 of the staging rows the analysis reads: a row digest per row, then the sorted digests hashed together. */
function fingerprintCtes(layouts: EjesLayouts): string[] {
  const column = (logical: string): string => `s.${col(layouts, "STAGING", logical)}`;
  const fields = [
    EJES_STAGING_COLUMN.REFTRAMO,
    EJES_STAGING_COLUMN.IDCALLE,
    EJES_STAGING_COLUMN.NOMBRE,
    EJES_STAGING_COLUMN.TIPO_VIALIDAD,
    EJES_STAGING_COLUMN.FUENTE,
    EJES_STAGING_COLUMN.DEPARTAMENTO,
    EJES_STAGING_COLUMN.LOCALIDAD,
  ].map((logical) => `quote_nullable(${column(logical)}::text)`);
  const geometry = `quote_nullable(md5(ST_AsEWKB(${column(EJES_STAGING_COLUMN.GEOM)})))`;
  const rowDigest = `md5(concat_ws(',', ${[...fields, geometry].join(", ")}))`;
  return [
    cte(
      "staging_fp",
      [
        "SELECT count(*) AS row_count, COALESCE(md5(string_agg(f.digest, '' ORDER BY f.digest)), '') AS digest",
        `FROM (SELECT ${rowDigest} AS digest FROM ${table(layouts, "STAGING")} AS s) AS f`,
      ].join(" ")
    ),
  ];
}

export function circulationPairsCte(layouts: EjesLayouts): string {
  const way = (logical: string): string => `w.${col(layouts, "CIRCULATION_WAY", logical)}`;
  return cte(
    "cw_pairs",
    `SELECT DISTINCT ${canonicalTextSql(way(CIRCULATION_WAY_COLUMN.CALLE))} AS idcalle, ${trimmed(way(CIRCULATION_WAY_COLUMN.NAME))} AS name FROM ${table(layouts, "CIRCULATION_WAY")} AS w`
  );
}

/** Points per section `reftramo`; `filter` narrows the access points read, e.g. to the references already known. */
export function pointsCte(layouts: EjesLayouts, filter = ""): string {
  return cte(
    "ap",
    `SELECT ${accessPointRefSql(layouts)} AS ref, count(*) AS points FROM ${table(layouts, "ACCESS_POINT")} AS a ${filter} GROUP BY 1`
  );
}

/** One row per kept copy (`reftramo + localidad + departamento`); the load writes exactly these rows. */
export function copyRawCte(layouts: EjesLayouts): string {
  const column = (logical: string): string => `s.${col(layouts, "STAGING", logical)}`;
  const reference = canonicalTextSql(column(EJES_STAGING_COLUMN.REFTRAMO));
  const geometry = column(EJES_STAGING_COLUMN.GEOM);
  return cte(
    "copy_raw",
    [
      "SELECT DISTINCT ON (raw.ref, raw.localidad, raw.departamento) raw.* FROM (SELECT",
      `${reference} AS ref,`,
      `${canonicalTextSql(column(EJES_STAGING_COLUMN.IDCALLE))} AS idcalle,`,
      `${trimmed(column(EJES_STAGING_COLUMN.NOMBRE))} AS nombre,`,
      `${trimmed(column(EJES_STAGING_COLUMN.TIPO_VIALIDAD))} AS tipo,`,
      `${trimmed(column(EJES_STAGING_COLUMN.FUENTE))} AS fuente,`,
      `${trimmed(column(EJES_STAGING_COLUMN.DEPARTAMENTO))} AS departamento,`,
      `${trimmed(column(EJES_STAGING_COLUMN.LOCALIDAD))} AS localidad,`,
      `${geometry} AS geom`,
      `FROM ${table(layouts, "STAGING")} AS s WHERE ${geometry} IS NOT NULL AND NOT ST_IsEmpty(${geometry}) AND ${validGeometrySql(geometry)}`,
      `AND ${reference} ~ '${INTEGER_PATTERN}') AS raw`,
      "ORDER BY raw.ref, raw.localidad, raw.departamento, raw.idcalle, raw.nombre, raw.tipo, raw.fuente, ST_AsEWKB(raw.geom)",
    ].join(" ")
  );
}

/** A new `reftramo` held by a skipped renumber pair is neither new nor inserted: its section and its old one stay as they are. */
const heldNewSql = (reference: string): string =>
  `${reference} NOT IN (SELECT new_ref FROM ${q("renum_skipped")}) AND ${reference} NOT IN (SELECT ref FROM ${q("group_pieces")})`;

export const copyKeptCte = (): string =>
  cte(
    "copy_kept",
    `SELECT r.* FROM ${q("copy_raw")} AS r LEFT JOIN ${q("twins")} AS w ON w.ref = r.ref WHERE w.ref IS NULL OR r.localidad IS NULL OR NOT (r.localidad = ANY (w.drop_localities))`
  );

/** Kept copies per `reftramo`: a renumber onto a `reftramo` with one copy only. */
const copyCountCte = (): string => cte("copy_refs", `SELECT k.ref, count(*) AS copies FROM ${q("copy_kept")} AS k GROUP BY k.ref`);

export function currentCtes(layouts: EjesLayouts): string[] {
  const section = (logical: string): string => `r.${col(layouts, "ROAD_SECTION", logical)}`;
  return [
    circulationPairsCte(layouts),
    cte("cw", `SELECT idcalle, min(name) AS name FROM ${q("cw_pairs")} GROUP BY idcalle`),
    cte(
      "cur",
      [
        "SELECT",
        `${section(ROAD_SECTION_COLUMN.ID)} AS id,`,
        `${canonicalTextSql(section(ROAD_SECTION_COLUMN.REFTRAMO))} AS ref,`,
        `${canonicalTextSql(section(ROAD_SECTION_COLUMN.CIRCULATION_WAY))} AS idcalle,`,
        `${section(ROAD_SECTION_COLUMN.TYPE)}::text AS type_id,`,
        `${section(ROAD_SECTION_COLUMN.FONT)}::text AS font_id,`,
        `${section(ROAD_SECTION_COLUMN.GEOMETRY)} AS geometry`,
        `FROM ${table(layouts, "ROAD_SECTION")} AS r`,
      ].join(" ")
    ),
    pointsCte(layouts),
  ];
}

function classifiedCtes(): string[] {
  return [
    cte(
      "matched",
      [
        "SELECT s.ref, s.idcalle, s.nombre, s.geom, s.departamento, s.localidad, s.tipo, s.fuente,",
        "c.id AS cur_id, c.idcalle AS cur_idcalle, w.name AS cur_name, c.type_id AS cur_type_id, c.font_id AS cur_font_id, c.geometry AS cur_geometry,",
        "tm.id::text AS new_type_id, fm.id::text AS new_font_id",
        `FROM ${q("stg")} AS s`,
        `LEFT JOIN ${q("cur")} AS c ON c.ref = s.ref`,
        `LEFT JOIN ${q("cw")} AS w ON w.idcalle = c.idcalle`,
        `LEFT JOIN ${q(TIPO_MAP_CTE_NAME)} AS tm ON tm.label = s.tipo`,
        `LEFT JOIN ${q(FUENTE_MAP_CTE_NAME)} AS fm ON fm.label = s.fuente`,
      ].join(" ")
    ),
    cte(
      "classified",
      [
        "SELECT m.*, (m.cur_id IS NULL) AS is_new,",
        "(m.cur_id IS NOT NULL AND (m.nombre IS DISTINCT FROM m.cur_name OR m.idcalle IS DISTINCT FROM m.cur_idcalle",
        "OR m.new_type_id IS DISTINCT FROM m.cur_type_id OR m.new_font_id IS DISTINCT FROM m.cur_font_id)) AS attr_changed,",
        `(m.cur_id IS NOT NULL AND ${geometriesDifferSql("m.cur_geometry", "m.geom")}) AS geom_changed`,
        `FROM ${q("matched")} AS m`,
      ].join(" ")
    ),
  ];
}

function removalCtes(): string[] {
  return [
    cte(
      "removed",
      `SELECT c.id, c.ref, c.idcalle, c.geometry, ST_Length(c.geometry) AS len FROM ${q("cur")} AS c WHERE NOT EXISTS (SELECT 1 FROM ${q("stg_keys")} AS k WHERE k.ref = c.ref)`
    ),
    cte("new_sections", `SELECT ref, idcalle, geom FROM ${q("classified")} WHERE is_new`),
  ];
}

function splitCtes(): string[] {
  const tolerance = COVERAGE_TOLERANCE_M;
  return [
    cte(
      "piece_cover",
      [
        "SELECT r.id, r.ref, r.idcalle, r.len, r.geometry, n.ref AS new_ref, n.geom, ST_Length(n.geom) AS piece_len,",
        `ST_Length(ST_Intersection(r.geometry, ST_Buffer(n.geom, ${tolerance}))) AS piece_covered`,
        `FROM ${q("removed_rest")} AS r JOIN ${q("new_rest")} AS n ON n.idcalle = r.idcalle AND ST_DWithin(r.geometry, n.geom, ${tolerance})`,
        "WHERE r.len > 0",
      ].join(" ")
    ),
    cte(
      "removed_cover",
      [
        "SELECT p.id, p.ref, p.idcalle, p.len, count(p.new_ref) AS new_count,",
        `ST_Length(ST_Intersection(p.geometry, ST_Buffer(ST_Collect(p.geom), ${tolerance}))) AS covered,`,
        "array_agg(p.new_ref ORDER BY p.new_ref) AS new_refs,",
        "ST_Length(ST_Union(p.geom)) AS new_len,",
        `ST_Length(ST_Difference(ST_Union(p.geom), ST_Buffer(p.geometry, ${tolerance}))) AS outside_len`,
        `FROM ${q("piece_cover")} AS p WHERE ${isPieceSql("p.piece_covered", "p.len", "p.piece_len")}`,
        "GROUP BY p.id, p.ref, p.idcalle, p.len, p.geometry",
      ].join(" ")
    ),
    cte("splits", `SELECT * FROM ${q("removed_cover")} WHERE new_count >= 2 AND ${coverageThresholdSql("covered", "len")}`),
  ];
}

function mergeCtes(): string[] {
  const tolerance = COVERAGE_TOLERANCE_M;
  return [
    cte(
      "merge_pairs",
      [
        "SELECT n.ref AS new_ref, n.idcalle AS idcalle, r.id, r.ref AS old_ref, r.len, n.geom AS new_geom, ST_Length(n.geom) AS piece_len, r.geometry AS old_geom,",
        `ST_Length(ST_Intersection(r.geometry, ST_Buffer(n.geom, ${tolerance}))) AS covered`,
        `FROM ${q("new_rest")} AS n JOIN ${q("removed_rest")} AS r ON r.idcalle = n.idcalle AND ST_DWithin(r.geometry, n.geom, ${tolerance})`,
        `WHERE r.len > 0 AND r.id NOT IN (SELECT id FROM ${q("splits")})`,
      ].join(" ")
    ),
    cte(
      "merges",
      [
        "SELECT p.new_ref, min(p.idcalle) AS idcalle, array_agg(p.old_ref ORDER BY p.old_ref) AS old_refs,",
        "sum(p.covered) / NULLIF(sum(p.len), 0) AS coverage, sum(p.len) AS old_len, ST_Length((array_agg(p.new_geom))[1]) AS new_len,",
        `ST_Length(ST_Difference((array_agg(p.new_geom))[1], ST_Buffer(ST_Collect(p.old_geom), ${tolerance}))) AS outside_len,`,
        `COALESCE(sum(ap.points), 0) + COALESCE(sum(apid.points), 0) AS points FROM ${q("merge_pairs")} AS p`,
        `LEFT JOIN ${q("ap")} AS ap ON ap.ref = p.old_ref LEFT JOIN ${q("ap")} AS apid ON apid.ref = p.id::text`,
        `WHERE ${isPieceSql("p.covered", "p.len", "p.piece_len")} GROUP BY p.new_ref HAVING count(*) >= 2 AND ${coverageThresholdSql("sum(p.covered)", "sum(p.len)")}`,
      ].join(" ")
    ),
    cte(
      "merged_ids",
      `SELECT DISTINCT p.id FROM ${q("merge_pairs")} AS p JOIN ${q("merges")} AS m ON m.new_ref = p.new_ref WHERE ${isPieceSql("p.covered", "p.len", "p.piece_len")}`
    ),
  ];
}

function remainderCtes(): string[] {
  return [
    cte(
      "plain",
      `SELECT r.id, r.ref, r.idcalle FROM ${q("removed_rest")} AS r WHERE r.id NOT IN (SELECT id FROM ${q("splits")}) AND r.id NOT IN (SELECT id FROM ${q("merged_ids")})`
    ),
    cte(
      "new_streets",
      `SELECT c.idcalle, c.nombre AS name, count(*) AS sections, string_agg(DISTINCT c.tipo, ', ') AS tipos, string_agg(DISTINCT c.departamento, ', ') AS departments, string_agg(DISTINCT c.localidad, ', ') AS localities FROM ${q("classified")} AS c WHERE c.is_new AND ${heldNewSql("c.ref")} AND NOT EXISTS (SELECT 1 FROM ${q("cw_pairs")} AS p WHERE p.idcalle IS NOT DISTINCT FROM c.idcalle AND p.name IS NOT DISTINCT FROM c.nombre) GROUP BY c.idcalle, c.nombre`
    ),
  ];
}

function clocCtes(layouts: EjesLayouts): string[] {
  const locality = (logical: string): string => `l.${col(layouts, "LOCALITIES", logical)}`;
  const department = (logical: string): string => `d.${col(layouts, "DEPARTMENTS", logical)}`;
  const localityGeometry = locality(LOCALITIES_COLUMN.GEOM);
  return [
    cte(
      "dept",
      `SELECT ${trimmed(department(DEPARTMENTS_COLUMN.ISO_CODE))} AS code, upper(${trimmed(department(DEPARTMENTS_COLUMN.NAME))}) AS name FROM ${table(layouts, "DEPARTMENTS")} AS d`
    ),
    cte(
      "located",
      [
        "SELECT c.ref,",
        `(SELECT ${locality(LOCALITIES_COLUMN.CLOC_ISO)} FROM ${table(layouts, "LOCALITIES")} AS l`,
        `WHERE ST_Intersects(${localityGeometry}, c.geom)`,
        `ORDER BY ST_Length(ST_Intersection(${localityGeometry}, c.geom)) DESC LIMIT 1) AS cloc,`,
        `(SELECT dp.code FROM ${q("dept")} AS dp WHERE dp.code = upper(c.departamento) OR dp.name = upper(c.departamento) LIMIT 1) AS dept_code`,
        `FROM ${q("classified")} AS c WHERE (c.is_new AND ${heldNewSql("c.ref")}) OR c.geom_changed`,
      ].join(" ")
    ),
  ];
}

function listColumns(): string[] {
  const splitSelect = [
    'SELECT s.ref AS "old_ref", s.idcalle AS "idcalle", s.new_refs AS "new_refs", COALESCE(ap.points, 0) + COALESCE(apid.points, 0) AS "points",',
    'COALESCE(st.ref_points, 0) AS "ref_points", COALESCE(st.auto_points, 0) AS "auto_points", COALESCE(st.review_points, 0) AS "review_points", COALESCE(st.no_geometry_points, 0) AS "no_geometry_points", COALESCE(st.far_points, 0) AS "far_points",',
    'hg.hold_reason AS "held_reason", COALESCE(NOT rf.fits, false) AS "review_incomplete",',
    's.covered / NULLIF(s.len, 0) AS "coverage", s.len AS "old_length", s.new_len AS "new_length", s.outside_len AS "outside_length"',
    `FROM ${q("splits")} AS s LEFT JOIN ${q("ap")} AS ap ON ap.ref = s.ref LEFT JOIN ${q("ap")} AS apid ON apid.ref = s.id::text LEFT JOIN ${q("split_stats")} AS st ON st.old_id = s.id`,
    `LEFT JOIN ${q("split_groups")} AS hg ON hg.old_id = s.id LEFT JOIN ${q("review_fit")} AS rf ON rf.old_id = s.id ORDER BY s.ref`,
  ].join(" ");
  const mergeSelect = `SELECT m.new_ref AS "new_ref", m.idcalle AS "idcalle", m.old_refs AS "old_refs", m.points AS "points", m.coverage AS "coverage", m.old_len AS "old_length", m.new_len AS "new_length", m.outside_len AS "outside_length" FROM ${q("merges")} AS m ORDER BY m.new_ref`;
  const plainSelect = `SELECT p.ref AS "ref", p.idcalle AS "idcalle", COALESCE(ap.points, 0) + COALESCE(apid.points, 0) AS "points" FROM ${q("plain")} AS p LEFT JOIN ${q("ap")} AS ap ON ap.ref = p.ref LEFT JOIN ${q("ap")} AS apid ON apid.ref = p.id::text ORDER BY COALESCE(ap.points, 0) + COALESCE(apid.points, 0) DESC, p.ref`;
  const streetSelect = `SELECT n.idcalle AS "idcalle", n.name AS "name", n.sections AS "sections", n.tipos AS "tipos", n.departments AS "departments", n.localities AS "localities" FROM ${q("new_streets")} AS n ORDER BY n.idcalle, n.name`;
  const attrSelect = [
    'SELECT c.ref AS "ref", c.nombre AS "name", c.cur_name AS "current_name", c.idcalle AS "idcalle", c.cur_idcalle AS "current_idcalle",',
    'c.new_type_id AS "type_id", c.cur_type_id AS "current_type_id", c.new_font_id AS "font_id", c.cur_font_id AS "current_font_id"',
    `FROM ${q("classified")} AS c WHERE c.attr_changed ORDER BY c.ref`,
  ].join(" ");
  return [
    listOf(ANALYSIS_LIST_ALIAS.SPLITS, "split_list", splitSelect),
    reviewPointsColumn(),
    listOf(ANALYSIS_LIST_ALIAS.MERGES, "merge_list", mergeSelect),
    listOf(ANALYSIS_LIST_ALIAS.PLAIN, "plain_list", plainSelect),
    listOf(ANALYSIS_LIST_ALIAS.STREETS, "street_list", streetSelect),
    listOf(ANALYSIS_LIST_ALIAS.ATTRS, "attr_list", attrSelect),
    twinListColumn(ANALYSIS_LIST_ALIAS.TWINS),
    renumberListColumn(ANALYSIS_LIST_ALIAS.RENUMBERED),
    renumberSkippedListColumn(ANALYSIS_LIST_ALIAS.RENUMBER_SKIPPED),
  ];
}

function countColumns(): string[] {
  return [
    `${countOf("classified", `is_new AND ${heldNewSql("ref")}`)} AS "new_sections"`,
    `${countOf("classified", "NOT is_new AND NOT attr_changed AND NOT geom_changed")} AS "unchanged"`,
    `${countOf("classified", "attr_changed")} AS "attr"`,
    `${countOf("classified", "geom_changed")} AS "geom"`,
    `${countOf("classified", "attr_changed AND geom_changed")} AS "both"`,
    `${countOf("removed", `id NOT IN (SELECT old_id FROM ${q("renum_skipped")})`)} AS "removed"`,
    `${countOf("splits")} AS "splits"`,
    `${countOf("merges")} AS "merges"`,
    ...splitPointCountColumns(),
    `${countOf("plain")} AS "plain_removals"`,
    `(SELECT count(*) FROM ${q("plain")} AS p WHERE EXISTS (SELECT 1 FROM ${q("ap")} AS ap WHERE ap.ref = p.ref AND ap.points > 0) OR EXISTS (SELECT 1 FROM ${q("ap")} AS apid WHERE apid.ref = p.id::text AND apid.points > 0)) AS "plain_held"`,
    `${countOf("new_streets")} AS "new_streets"`,
    `${countOf("located", "cloc IS NOT NULL")} AS "with_locality"`,
    `${countOf("located", "cloc IS NULL AND dept_code IS NOT NULL")} AS "only_department"`,
    `${countOf("located", "cloc IS NULL AND dept_code IS NULL")} AS "without_code"`,
    ...twinCountColumns(),
    ...renumberCountColumns(),
    `(SELECT row_count FROM ${q("staging_fp")}) AS "staging_rows"`,
    `(SELECT digest FROM ${q("staging_fp")}) AS "staging_digest"`,
  ];
}

/**
 * The analysis as one statement. With `sinks` (temp tables the caller created) the renumbered and the skipped renumber pairs are also
 * written there by data-modifying CTEs, which PostgreSQL runs once whether or not the result reads them: the load reuses them.
 */
export function buildEjesAnalysisSql(layouts: EjesLayouts, sinks?: AnalysisSinks): string {
  const ctes = [
    tipoMapCte(),
    fuenteMapCte(),
    ...stagingCtes(layouts),
    ...fingerprintCtes(layouts),
    ...currentCtes(layouts),
    ...classifiedCtes(),
    ...removalCtes(),
    ...twinGroupCtes(layouts),
    ...twinCtes(layouts),
    copyRawCte(layouts),
    copyKeptCte(),
    copyCountCte(),
    ...renumberCtes(),
    ...(sinks === undefined ? [] : renumberSinkCtes(sinks)),
    ...splitCtes(),
    ...mergeCtes(),
    ...groupPieceCtes(),
    ...remainderCtes(),
    ...(sinks === undefined ? [] : removalSinkCtes(sinks)),
    ...splitPointCtes(layouts),
    ...(sinks === undefined ? [] : splitPointSinkCtes(sinks.splitPoints)),
    ...reviewPointCtes(),
    ...clocCtes(layouts),
  ];
  return `${withClause(ctes)}\nSELECT\n${[...countColumns(), ...listColumns()].join(",\n")}`;
}
