import { physicalColumn, qualifiedName } from "../../actualizar-padron/domain/layouts";
import { DETAIL_LIST_LIMIT } from "../../shared/limits";
import { cte, jsonArrayOf, q, withClause } from "../../shared/sqlFragments";
import {
  ACCESS_POINT_COLUMN,
  CIRCULATION_WAY_COLUMN,
  COVERAGE_RATIO,
  COVERAGE_TOLERANCE_M,
  DEPARTMENTS_COLUMN,
  EJES_TABLE_ROLE,
  GEOMETRY_EQUALITY_DECIMALS,
  LOCALITIES_COLUMN,
  ROAD_SECTION_COLUMN,
  STAGING_COLUMN,
} from "../constants";
import type { EjesLayouts } from "../types";
import { FUENTE_MAP_CTE_NAME, fuenteMapCte, TIPO_MAP_CTE_NAME, tipoMapCte } from "./mappings";
import { INTEGER_PATTERN } from "./stagingSql";

const SNAP_GRID = 10 ** -GEOMETRY_EQUALITY_DECIMALS;

export const ANALYSIS_LIST_ALIAS = {
  SPLITS: "splits_json",
  MERGES: "merges_json",
  PLAIN: "plain_json",
  STREETS: "streets_json",
  ATTRS: "attrs_json",
} as const;

type RoleName = keyof typeof EJES_TABLE_ROLE;

const col = (layouts: EjesLayouts, role: RoleName, logical: string): string =>
  physicalColumn(layouts[EJES_TABLE_ROLE[role]], logical);

const table = (layouts: EjesLayouts, role: RoleName): string => qualifiedName(layouts[EJES_TABLE_ROLE[role]]);

const trimmed = (expression: string): string => `NULLIF(btrim(${expression}::text), '')`;

export const comparableLineSql = (geometry: string): string =>
  `ST_Normalize(ST_SnapToGrid(ST_LineMerge(${geometry}), ${SNAP_GRID}))`;

export const geometriesDifferSql = (current: string, incoming: string): string =>
  `NOT COALESCE(ST_OrderingEquals(${comparableLineSql(current)}, ${comparableLineSql(incoming)}), false)`;

export const coverageThresholdSql = (covered: string, length: string): string =>
  `${covered} >= ${COVERAGE_RATIO} * ${length}`;

function stagingCtes(layouts: EjesLayouts): string[] {
  const staging = table(layouts, "STAGING");
  const column = (logical: string): string => `s.${col(layouts, "STAGING", logical)}`;
  const reference = trimmed(column(STAGING_COLUMN.REFTRAMO));
  const geometry = column(STAGING_COLUMN.GEOM);
  return [
    cte("stg_keys", `SELECT DISTINCT ${reference} AS ref FROM ${staging} AS s WHERE ${reference} IS NOT NULL`),
    cte(
      "stg",
      [
        "SELECT DISTINCT ON (raw.ref) raw.* FROM (SELECT",
        `${reference} AS ref,`,
        `${trimmed(column(STAGING_COLUMN.IDCALLE))} AS idcalle,`,
        `${trimmed(column(STAGING_COLUMN.NOMBRE))} AS nombre,`,
        `${trimmed(column(STAGING_COLUMN.TIPO_VIALIDAD))} AS tipo,`,
        `${trimmed(column(STAGING_COLUMN.FUENTE))} AS fuente,`,
        `${trimmed(column(STAGING_COLUMN.DEPARTAMENTO))} AS departamento,`,
        `${geometry} AS geom`,
        `FROM ${staging} AS s WHERE ${geometry} IS NOT NULL AND NOT ST_IsEmpty(${geometry})`,
        `AND ${reference} ~ '${INTEGER_PATTERN}') AS raw ORDER BY raw.ref`,
      ].join(" ")
    ),
  ];
}

function currentCtes(layouts: EjesLayouts): string[] {
  const section = (logical: string): string => `r.${col(layouts, "ROAD_SECTION", logical)}`;
  const way = (logical: string): string => `w.${col(layouts, "CIRCULATION_WAY", logical)}`;
  const point = (logical: string): string => `a.${col(layouts, "ACCESS_POINT", logical)}`;
  return [
    cte(
      "cw_pairs",
      `SELECT DISTINCT ${trimmed(way(CIRCULATION_WAY_COLUMN.CALLE))} AS idcalle, ${trimmed(way(CIRCULATION_WAY_COLUMN.NAME))} AS name FROM ${table(layouts, "CIRCULATION_WAY")} AS w`
    ),
    cte("cw", `SELECT idcalle, min(name) AS name FROM ${q("cw_pairs")} GROUP BY idcalle`),
    cte(
      "cur",
      [
        "SELECT",
        `${section(ROAD_SECTION_COLUMN.ID)} AS id,`,
        `${trimmed(section(ROAD_SECTION_COLUMN.REFTRAMO))} AS ref,`,
        `${trimmed(section(ROAD_SECTION_COLUMN.CIRCULATION_WAY))} AS idcalle,`,
        `${section(ROAD_SECTION_COLUMN.TYPE)}::text AS type_id,`,
        `${section(ROAD_SECTION_COLUMN.FONT)}::text AS font_id,`,
        `${section(ROAD_SECTION_COLUMN.GEOMETRY)} AS geometry`,
        `FROM ${table(layouts, "ROAD_SECTION")} AS r`,
      ].join(" ")
    ),
    cte(
      "ap",
      `SELECT ${trimmed(point(ACCESS_POINT_COLUMN.ROAD_SECTION))} AS ref, count(*) AS points FROM ${table(layouts, "ACCESS_POINT")} AS a GROUP BY 1`
    ),
  ];
}

function classifiedCtes(): string[] {
  return [
    cte(
      "matched",
      [
        "SELECT s.ref, s.idcalle, s.nombre, s.geom, s.departamento,",
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

function splitCtes(): string[] {
  const tolerance = COVERAGE_TOLERANCE_M;
  return [
    cte(
      "removed",
      `SELECT c.id, c.ref, c.idcalle, c.geometry, ST_Length(c.geometry) AS len FROM ${q("cur")} AS c WHERE NOT EXISTS (SELECT 1 FROM ${q("stg_keys")} AS k WHERE k.ref = c.ref)`
    ),
    cte("new_sections", `SELECT ref, idcalle, geom FROM ${q("classified")} WHERE is_new`),
    cte(
      "removed_cover",
      [
        "SELECT r.id, r.ref, r.idcalle, r.len, count(n.ref) AS new_count,",
        `ST_Length(ST_Intersection(r.geometry, ST_Buffer(ST_Collect(n.geom), ${tolerance}))) AS covered,`,
        "array_agg(n.ref ORDER BY n.ref) AS new_refs",
        `FROM ${q("removed")} AS r JOIN ${q("new_sections")} AS n ON n.idcalle = r.idcalle AND ST_DWithin(r.geometry, n.geom, ${tolerance})`,
        "WHERE r.len > 0 GROUP BY r.id, r.ref, r.idcalle, r.len, r.geometry",
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
        "SELECT n.ref AS new_ref, n.idcalle AS idcalle, r.id, r.ref AS old_ref, r.len,",
        `ST_Length(ST_Intersection(r.geometry, ST_Buffer(n.geom, ${tolerance}))) AS covered`,
        `FROM ${q("new_sections")} AS n JOIN ${q("removed")} AS r ON r.idcalle = n.idcalle AND ST_DWithin(r.geometry, n.geom, ${tolerance})`,
        `WHERE r.len > 0 AND r.id NOT IN (SELECT id FROM ${q("splits")})`,
      ].join(" ")
    ),
    cte(
      "merges",
      [
        "SELECT p.new_ref, min(p.idcalle) AS idcalle, array_agg(p.old_ref ORDER BY p.old_ref) AS old_refs,",
        "sum(p.covered) / NULLIF(sum(p.len), 0) AS coverage,",
        `COALESCE(sum(ap.points), 0) AS points FROM ${q("merge_pairs")} AS p LEFT JOIN ${q("ap")} AS ap ON ap.ref = p.old_ref`,
        `WHERE p.covered > 0 GROUP BY p.new_ref HAVING count(*) >= 2 AND ${coverageThresholdSql("sum(p.covered)", "sum(p.len)")}`,
      ].join(" ")
    ),
    cte(
      "merged_ids",
      `SELECT DISTINCT p.id FROM ${q("merge_pairs")} AS p JOIN ${q("merges")} AS m ON m.new_ref = p.new_ref WHERE p.covered > 0`
    ),
  ];
}

function remainderCtes(): string[] {
  return [
    cte(
      "plain",
      `SELECT r.id, r.ref, r.idcalle FROM ${q("removed")} AS r WHERE r.id NOT IN (SELECT id FROM ${q("splits")}) AND r.id NOT IN (SELECT id FROM ${q("merged_ids")})`
    ),
    cte(
      "new_streets",
      `SELECT c.idcalle, c.nombre AS name, count(*) AS sections FROM ${q("classified")} AS c WHERE c.is_new AND NOT EXISTS (SELECT 1 FROM ${q("cw_pairs")} AS p WHERE p.idcalle IS NOT DISTINCT FROM c.idcalle AND p.name IS NOT DISTINCT FROM c.nombre) GROUP BY c.idcalle, c.nombre`
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
        `FROM ${q("classified")} AS c WHERE c.is_new OR c.geom_changed`,
      ].join(" ")
    ),
  ];
}

const limited = (select: string): string => `${select} LIMIT ${DETAIL_LIST_LIMIT}`;

const countOf = (source: string, condition = "true"): string => `(SELECT count(*) FROM ${q(source)} WHERE ${condition})`;

const listOf = (alias: string, name: string, select: string): string =>
  `${jsonArrayOf(limited(select), name)} AS ${q(alias)}`;

function listColumns(): string[] {
  const splitSelect = `SELECT s.ref AS "old_ref", s.idcalle AS "idcalle", s.new_refs AS "new_refs", COALESCE(ap.points, 0) AS "points", s.covered / NULLIF(s.len, 0) AS "coverage" FROM ${q("splits")} AS s LEFT JOIN ${q("ap")} AS ap ON ap.ref = s.ref ORDER BY s.ref`;
  const mergeSelect = `SELECT m.new_ref AS "new_ref", m.idcalle AS "idcalle", m.old_refs AS "old_refs", m.points AS "points", m.coverage AS "coverage" FROM ${q("merges")} AS m ORDER BY m.new_ref`;
  const plainSelect = `SELECT p.ref AS "ref", p.idcalle AS "idcalle", COALESCE(ap.points, 0) AS "points" FROM ${q("plain")} AS p LEFT JOIN ${q("ap")} AS ap ON ap.ref = p.ref ORDER BY p.ref`;
  const streetSelect = `SELECT n.idcalle AS "idcalle", n.name AS "name", n.sections AS "sections" FROM ${q("new_streets")} AS n ORDER BY n.idcalle, n.name`;
  const attrSelect = [
    'SELECT c.ref AS "ref", c.nombre AS "name", c.cur_name AS "current_name", c.idcalle AS "idcalle", c.cur_idcalle AS "current_idcalle",',
    'c.new_type_id AS "type_id", c.cur_type_id AS "current_type_id", c.new_font_id AS "font_id", c.cur_font_id AS "current_font_id"',
    `FROM ${q("classified")} AS c WHERE c.attr_changed ORDER BY c.ref`,
  ].join(" ");
  return [
    listOf(ANALYSIS_LIST_ALIAS.SPLITS, "split_list", splitSelect),
    listOf(ANALYSIS_LIST_ALIAS.MERGES, "merge_list", mergeSelect),
    listOf(ANALYSIS_LIST_ALIAS.PLAIN, "plain_list", plainSelect),
    listOf(ANALYSIS_LIST_ALIAS.STREETS, "street_list", streetSelect),
    listOf(ANALYSIS_LIST_ALIAS.ATTRS, "attr_list", attrSelect),
  ];
}

function countColumns(): string[] {
  return [
    `${countOf("classified", "is_new")} AS "new_sections"`,
    `${countOf("classified", "NOT is_new AND NOT attr_changed AND NOT geom_changed")} AS "unchanged"`,
    `${countOf("classified", "attr_changed")} AS "attr"`,
    `${countOf("classified", "geom_changed")} AS "geom"`,
    `${countOf("classified", "attr_changed AND geom_changed")} AS "both"`,
    `${countOf("removed")} AS "removed"`,
    `${countOf("splits")} AS "splits"`,
    `${countOf("merges")} AS "merges"`,
    `${countOf("plain")} AS "plain_removals"`,
    `${countOf("new_streets")} AS "new_streets"`,
    `${countOf("located", "cloc IS NOT NULL")} AS "with_locality"`,
    `${countOf("located", "cloc IS NULL AND dept_code IS NOT NULL")} AS "only_department"`,
    `${countOf("located", "cloc IS NULL AND dept_code IS NULL")} AS "without_code"`,
  ];
}

export function buildEjesAnalysisSql(layouts: EjesLayouts): string {
  const ctes = [
    tipoMapCte(),
    fuenteMapCte(),
    ...stagingCtes(layouts),
    ...currentCtes(layouts),
    ...classifiedCtes(),
    ...splitCtes(),
    ...mergeCtes(),
    ...remainderCtes(),
    ...clocCtes(layouts),
  ];
  return `${withClause(ctes)}\nSELECT\n${[...countColumns(), ...listColumns()].join(",\n")}`;
}
