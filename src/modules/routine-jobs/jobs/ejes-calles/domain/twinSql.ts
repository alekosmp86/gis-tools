import { cte, q } from "../../shared/sqlFragments";
import {
  DEPARTMENTS_COLUMN,
  EJES_SRID,
  LOCALITIES_COLUMN,
  PADRON_COLUMN,
  PADRON_TYPE,
  RURAL_LOCALITY_SUFFIX,
  EJES_STAGING_COLUMN,
  TWIN_CLASS,
  TWIN_NEAR_MIN_LENGTH_M,
  TWIN_NEAREST_POLYGON_MAX_M,
  TWIN_PADRON_DISTANCE_M,
  TWIN_PICKS_CTE,
  TWIN_POLYGON_MIN_COVER_RATIO,
} from "../constants";
import type { EjesLayouts } from "../types";
import { col, countOf, listOf, scopedTable, table, trimmed } from "./layoutSql";
import { pickNamesCopySql } from "./twinPickSql";
import { canonicalTextSql, keptStagingRowSql } from "./stagingSql";

/** True when a copy's department (`copy`, trimmed text) is the chosen one (`chosen`, upper-cased, NULL when none); a copy with no department is kept. */
export const departmentKeepsSql = (copy: string, chosen: string): string =>
  `(${chosen} IS NULL OR ${copy} IS NULL OR upper(btrim(${copy})) = ${chosen})`;

const departmentOf = (layouts: EjesLayouts, logical: string): string => `dp.${col(layouts, "DEPARTMENTS", logical)}`;

/**
 * The department whose polygon the section overlaps most (ET-2a): the upper-cased trimmed name with the longest overlap, name ASC on a tie.
 * NULL when no department polygon intersects the section. `geometry` names the section's geometry.
 */
function departmentChoiceSql(geometry: string): string {
  return [
    `(SELECT d.name FROM (SELECT dp.name, sum(ST_Length(ST_Intersection(${geometry}, dp.valid))) AS len`,
    `FROM ${q("dept_valid")} AS dp WHERE ST_Intersects(dp.geometry, ${geometry}) GROUP BY 1) AS d`,
    "ORDER BY d.len DESC, d.name LIMIT 1)",
  ].join(" ");
}

/**
 * The department polygons, upper-cased name and made valid once (`dept_valid`), read by `twin_dept`.
 */
function deptValidCte(layouts: EjesLayouts): string {
  const polygon = departmentOf(layouts, DEPARTMENTS_COLUMN.GEOM);
  const name = departmentOf(layouts, DEPARTMENTS_COLUMN.NAME);
  return cte(
    "dept_valid",
    `SELECT upper(btrim(${name})) AS name, ${polygon} AS geometry, ST_MakeValid(${polygon}) AS valid FROM ${table(layouts, "DEPARTMENTS")} AS dp WHERE ${name} IS NOT NULL`
  );
}

/**
 * One row per multi-department `reftramo` (ET-2a): `department` is the chosen department (upper-cased, as `departmentChoiceSql`), NULL when no
 * department polygon intersects the section. Single-department `reftramo`s have no row.
 */
function twinDeptCtes(layouts: EjesLayouts): string[] {
  return [
    deptValidCte(layouts),
    cte(
      "twin_dept",
      [
        `SELECT m.ref, ${departmentChoiceSql("m.geom")} AS department`,
        `FROM (SELECT t.ref, (array_agg(t.geom))[1] AS geom FROM ${q("twin_raw")} AS t GROUP BY t.ref HAVING count(DISTINCT t.departamento) > 1) AS m`,
      ].join(" ")
    ),
  ];
}

export function twinGroupCtes(layouts: EjesLayouts): string[] {
  const column = (logical: string): string => `s.${col(layouts, "STAGING", logical)}`;
  const reference = canonicalTextSql(column(EJES_STAGING_COLUMN.REFTRAMO));
  const geometry = column(EJES_STAGING_COLUMN.GEOM);
  return [
    cte(
      "twin_raw",
      [
        "SELECT",
        `${reference} AS ref,`,
        `${canonicalTextSql(column(EJES_STAGING_COLUMN.IDCALLE))} AS idcalle,`,
        `${trimmed(column(EJES_STAGING_COLUMN.DEPARTAMENTO))} AS departamento,`,
        `${trimmed(column(EJES_STAGING_COLUMN.LOCALIDAD))} AS localidad,`,
        `ST_SetSRID(${geometry}, ${EJES_SRID}) AS geom`,
        `FROM ${scopedTable(layouts, "STAGING")} AS s WHERE ${keptStagingRowSql(geometry, reference)}`,
      ].join(" ")
    ),
    ...twinDeptCtes(layouts),
    cte(
      "twin_groups",
      [
        "SELECT t.ref, min(t.idcalle) AS idcalle, min(t.departamento) AS department, count(DISTINCT t.departamento) AS departments,",
        "count(DISTINCT t.localidad) AS locality_count,",
        "array_agg(DISTINCT t.localidad ORDER BY t.localidad) FILTER (WHERE t.localidad IS NOT NULL) AS localities,",
        `(array_agg(t.geom))[1] AS geom FROM ${q("twin_raw")} AS t LEFT JOIN ${q("twin_dept")} AS d ON d.ref = t.ref`,
        `WHERE ${departmentKeepsSql("t.departamento", "d.department")} GROUP BY t.ref`,
        "HAVING count(DISTINCT t.departamento) > 1 OR count(DISTINCT t.localidad) >= 2",
      ].join(" ")
    ),
  ];
}

const nearLengthSql = (layouts: EjesLayouts, padronType: string): string => {
  const padron = (logical: string): string => `p.${col(layouts, "PADRONES", logical)}`;
  const geometry = padron(PADRON_COLUMN.GEOMETRY);
  return [
    `COALESCE((SELECT ST_Length(ST_Intersection(g.geom, ST_Union(ST_Buffer(${geometry}, ${TWIN_PADRON_DISTANCE_M}))))`,
    `FROM ${table(layouts, "PADRONES")} AS p`,
    `WHERE upper(btrim(${padron(PADRON_COLUMN.TYPE)}::text)) = '${padronType}' AND ST_DWithin(${geometry}, g.geom, ${TWIN_PADRON_DISTANCE_M})), 0)`,
  ].join(" ");
};

/** The name key of a locality (ET-10): upper-cased, the ' - KM 110' style suffix and every character but A-Z, 0-9 and space dropped, so accents and mojibake do not split one name. */
export const localityKeySql = (expression: string): string =>
  `regexp_replace(upper(btrim(split_part(${expression}, ' - ', 1))), '[^A-Z0-9 ]', '', 'g')`;

const ruralNamed = (locality: string): string => `${localityKeySql(locality)} LIKE '%${RURAL_LOCALITY_SUFFIX}'`;

/** The polygon winner: the first candidate by overlap rank in `inside`, then non-rural-named, then name ASC. */
const polygonWinnerSql = (candidates: string, inside: string): string =>
  `(SELECT r FROM unnest(${candidates}) AS r ORDER BY array_position(${inside}, ${localityKeySql("r")}) ASC NULLS LAST, (${ruralNamed("r")}) ASC, r ASC LIMIT 1)`;

/** The rural winner (ET-10): the rural-named candidate named `<department> RURAL`, else the rural-named candidate with the lowest name. */
const ruralWinnerSql = (candidates: string, department: string): string =>
  `(SELECT r FROM unnest(${candidates}) AS r WHERE ${ruralNamed("r")} ORDER BY COALESCE(${localityKeySql("r")} = (${localityKeySql(department)} || '${RURAL_LOCALITY_SUFFIX}'), false) DESC, r ASC LIMIT 1)`;

/** The default winner (ET-36): the padron class first (rural-named when the rural length is longer, else not rural-named), then the nearest polygon, then name ASC. */
const defaultWinnerSql = (candidates: string, nearest: string, urbanLength: string, ruralLength: string): string =>
  `(SELECT r FROM unnest(${candidates}) AS r ORDER BY CASE WHEN ${ruralLength} > ${urbanLength} THEN NOT (${ruralNamed("r")}) ELSE (${ruralNamed("r")}) END ASC, array_position(${nearest}, ${localityKeySql("r")}) ASC NULLS LAST, r ASC LIMIT 1)`;

/** The section lies mostly outside the locality polygons (ET-10): its rural-named copy wins when one remains. */
const belowCoverSql = (alias: string): string => `${alias}.inside_cover < ${TWIN_POLYGON_MIN_COVER_RATIO}`;

/**
 * The class rule of ET-10 (the base drop, before the single-copy step of `twinDropCaseSql`). `alias` names a relation with
 * `class`, `localities` (text[]), `inside_localities` (text[]), `inside_cover` and `department`. URBAN drops the rural-named copies;
 * RURAL and NEITHER with no inside polygon keep the first rural-named copy; BOTH keeps the winner (the rural winner when the section
 * lies mostly outside the polygons and a rural-named copy exists); NEITHER with an inside polygon keeps the copies whose name is in it.
 */
function twinClassDropSql(alias: string): string {
  const field = (name: string): string => `${alias}.${name}`;
  const localities = field("localities");
  const inside = field("inside_localities");
  const hasLocality = (rural: boolean): string =>
    `EXISTS (SELECT 1 FROM unnest(${localities}) AS h WHERE ${rural ? "" : "NOT "}${ruralNamed("h")})`;
  const noInside = `cardinality(${inside}) = 0`;
  const insideName = (locality: string): string => `${localityKeySql(locality)} = ANY(${inside})`;
  const isNeither = `${field("class")} = '${TWIN_CLASS.NEITHER}'`;
  const isBoth = `${field("class")} = '${TWIN_CLASS.BOTH}'`;
  const bothWinner = `(CASE WHEN ${belowCoverSql(alias)} AND ${hasLocality(true)} THEN ${ruralWinnerSql(localities, field("department"))} ELSE ${polygonWinnerSql(localities, inside)} END)`;
  return [
    "CASE",
    `WHEN ${field("class")} = '${TWIN_CLASS.URBAN}' AND ${hasLocality(false)} THEN ARRAY(SELECT l FROM unnest(${localities}) AS l WHERE ${ruralNamed("l")} ORDER BY l)`,
    `WHEN (${field("class")} = '${TWIN_CLASS.RURAL}' OR (${isNeither} AND ${noInside})) AND ${hasLocality(true)} THEN ARRAY(SELECT l FROM unnest(${localities}) AS l`,
    `WHERE NOT ${ruralNamed("l")} OR l <> (SELECT min(r) FROM unnest(${localities}) AS r WHERE ${ruralNamed("r")}) ORDER BY l)`,
    `WHEN ${isBoth} THEN ARRAY(SELECT l FROM unnest(${localities}) AS l WHERE l <> ${bothWinner} ORDER BY l)`,
    `WHEN ${isNeither} AND NOT ${noInside}`,
    `AND EXISTS (SELECT 1 FROM unnest(${localities}) AS h WHERE ${insideName("h")})`,
    `THEN ARRAY(SELECT l FROM unnest(${localities}) AS l WHERE NOT ${insideName("l")} ORDER BY l)`,
    "ELSE ARRAY[]::text[] END",
  ].join(" ");
}

/**
 * The localities of a twin row to drop (ET-10, ET-19, ET-36). `alias` names a relation with `class`, `localities` (text[], the copies'
 * localities as stored), `inside_localities` (text[], the name keys (`localityKeySql`) of the locality polygons the section intersects,
 * ordered by overlap length descending, so the first is the longest), `nearest_localities` (text[], the name keys of the locality polygons
 * within `TWIN_NEAREST_POLYGON_MAX_M` of the section, nearest first), `inside_cover` (double precision: the overlap of the longest polygon
 * over the section length, 0 when none), `department` (text, the group's department), `urban_len` and `rural_len` (double precision: the
 * section length near the urban and the rural padron). The base is the class rule (`twinClassDropSql`).
 * Single copy: when more than one copy remains after the base, the winner among the remaining copies stays and every other remaining
 * copy is dropped too. The winner is the rural winner when the section lies mostly outside the polygons and a rural-named copy remains,
 * else the polygon winner when one remaining copy is in `inside_localities`, else the default winner (ET-36). Otherwise the base is the
 * drop. It never drops all the localities.
 */
export function twinDropCaseSql(alias: string): string {
  const field = (name: string): string => `${alias}.${name}`;
  const localities = field("localities");
  const inside = field("inside_localities");
  const department = field("department");
  const rest = "twin_drop_rest.remaining";
  const restInside = restInsideSql(rest, inside);
  const outside = restOutsideSql(alias, rest);
  const defaultWinner = defaultWinnerSql(rest, field("nearest_localities"), field("urban_len"), field("rural_len"));
  const winner = `(CASE WHEN ${outside} THEN ${ruralWinnerSql(rest, department)} WHEN ${restInside} THEN ${polygonWinnerSql(rest, inside)} ELSE ${defaultWinner} END)`;
  return [
    `(SELECT CASE WHEN cardinality(${rest}) > 1`,
    `THEN ARRAY(SELECT l FROM unnest(${localities}) AS l WHERE l = ANY(twin_drop_base.base) OR l <> ${winner} ORDER BY l)`,
    "ELSE twin_drop_base.base END",
    `${twinRemainingSql(alias)})`,
  ].join(" ");
}

/** True when the default decision (ET-36) decides the twin row: more than one copy remains and no polygon or rural rule decided it. */
export function twinDefaultedSql(alias: string): string {
  const field = (name: string): string => `${alias}.${name}`;
  const rest = "twin_drop_rest.remaining";
  return `(SELECT cardinality(${rest}) > 1 AND NOT (${restInsideSql(rest, field("inside_localities"))} OR ${restOutsideSql(alias, rest)}) ${twinRemainingSql(alias)})`;
}

/** The copies left after the base drop, as `twin_drop_rest.remaining`; `twin_drop_base.base` is the base drop of the class rule. */
const twinRemainingSql = (alias: string): string =>
  `FROM (SELECT ${twinClassDropSql(alias)} AS base) AS twin_drop_base, LATERAL (SELECT ARRAY(SELECT l FROM unnest(${alias}.localities) AS l WHERE NOT l = ANY(twin_drop_base.base)) AS remaining) AS twin_drop_rest`;

const restInsideSql = (rest: string, inside: string): string =>
  `EXISTS (SELECT 1 FROM unnest(${rest}) AS h WHERE ${localityKeySql("h")} = ANY(${inside}))`;

const restOutsideSql = (alias: string, rest: string): string =>
  `(${belowCoverSql(alias)} AND EXISTS (SELECT 1 FROM unnest(${rest}) AS h WHERE ${ruralNamed("h")}))`;

/** The locality polygons a section intersects: their name keys (longest overlap first) and the overlap of the longest one. `k` is the section. */
function insideLocalitiesSql(layouts: EjesLayouts): string {
  const locality = (logical: string): string => `l.${col(layouts, "LOCALITIES", logical)}`;
  return [
    "SELECT COALESCE(array_agg(t.n ORDER BY t.len DESC, t.n), ARRAY[]::text[]) AS inside_localities, COALESCE(max(t.len), 0) AS inside_len FROM",
    `(SELECT ${localityKeySql(`${locality(LOCALITIES_COLUMN.NAME)}::text`)} AS n,`,
    `sum(ST_Length(ST_Intersection(k.geom, ST_MakeValid(${locality(LOCALITIES_COLUMN.GEOM)})))) AS len FROM ${table(layouts, "LOCALITIES")} AS l`,
    `WHERE ${locality(LOCALITIES_COLUMN.NAME)} IS NOT NULL AND ST_Intersects(${locality(LOCALITIES_COLUMN.GEOM)}, k.geom) GROUP BY 1) AS t`,
  ].join(" ");
}

/** The name keys of the locality polygons within `TWIN_NEAREST_POLYGON_MAX_M` of the section, nearest first (ET-36). `k` is the section. */
function nearestLocalitiesSql(layouts: EjesLayouts): string {
  const locality = (logical: string): string => `l.${col(layouts, "LOCALITIES", logical)}`;
  return [
    "SELECT COALESCE(array_agg(t.n ORDER BY t.dist, t.n), ARRAY[]::text[]) AS nearest_localities FROM",
    `(SELECT ${localityKeySql(`${locality(LOCALITIES_COLUMN.NAME)}::text`)} AS n,`,
    `min(ST_Distance(k.geom, ST_MakeValid(${locality(LOCALITIES_COLUMN.GEOM)}))) AS dist FROM ${table(layouts, "LOCALITIES")} AS l`,
    `WHERE ${locality(LOCALITIES_COLUMN.NAME)} IS NOT NULL AND ST_DWithin(${locality(LOCALITIES_COLUMN.GEOM)}, k.geom, ${TWIN_NEAREST_POLYGON_MAX_M}) GROUP BY 1) AS t`,
  ].join(" ");
}

export function twinCtes(layouts: EjesLayouts): string[] {
  const near = (column: string): string => `m.${column} >= ${TWIN_NEAR_MIN_LENGTH_M}`;
  return [
    cte(
      "twin_measured",
      [
        "SELECT g.ref, g.idcalle, g.department, g.localities, g.geom, ST_Length(g.geom) AS len,",
        `${nearLengthSql(layouts, PADRON_TYPE.URBAN)} AS urban_len,`,
        `${nearLengthSql(layouts, PADRON_TYPE.RURAL)} AS rural_len`,
        `FROM ${q("twin_groups")} AS g WHERE g.departments = 1 AND g.locality_count >= 2`,
      ].join(" ")
    ),
    cte(
      "twin_classed",
      [
        "SELECT m.*, CASE",
        `WHEN ${near("urban_len")} AND ${near("rural_len")} THEN '${TWIN_CLASS.BOTH}'`,
        `WHEN ${near("urban_len")} THEN '${TWIN_CLASS.URBAN}'`,
        `WHEN ${near("rural_len")} THEN '${TWIN_CLASS.RURAL}'`,
        `ELSE '${TWIN_CLASS.NEITHER}' END AS class`,
        `FROM ${q("twin_measured")} AS m`,
      ].join(" ")
    ),
    cte(
      "twin_located",
      [
        `SELECT k.*, i.inside_localities, n.nearest_localities, CASE WHEN k.len > 0 THEN i.inside_len / k.len ELSE 0 END AS inside_cover`,
        `FROM ${q("twin_classed")} AS k CROSS JOIN LATERAL (${insideLocalitiesSql(layouts)}) AS i CROSS JOIN LATERAL (${nearestLocalitiesSql(layouts)}) AS n`,
      ].join(" ")
    ),
    cte(
      "twins",
      `SELECT c.*, ${twinDropCaseSql("c")} AS drop_localities, ${twinDefaultedSql("c")} AS drop_defaulted FROM ${q("twin_located")} AS c`
    ),
  ];
}

const TWIN_CLASS_ORDER = [TWIN_CLASS.NEITHER, TWIN_CLASS.BOTH, TWIN_CLASS.RURAL, TWIN_CLASS.URBAN];

const twinOrderSql = (): string =>
  `CASE t.class ${TWIN_CLASS_ORDER.map((twinClass, index) => `WHEN '${twinClass}' THEN ${index}`).join(" ")} END, t.ref`;

export const twinListColumn = (alias: string): string =>
  listOf(
    alias,
    "twin_list",
    `SELECT t.ref AS "ref", t.idcalle AS "idcalle", t.department AS "department", t.localities AS "localities", t.class AS "class", t.len AS "length", t.urban_len AS "urban_length", t.rural_len AS "rural_length", t.drop_localities AS "drop_localities", t.inside_localities AS "inside_localities" FROM ${q("twins")} AS t ORDER BY ${twinOrderSql()}`
  );

export const twinCountColumns = (): string[] => [
  `${countOf("twins")} AS "twins"`,
  ...Object.values(TWIN_CLASS).map((twinClass) => `${countOf("twins", `class = '${twinClass}'`)} AS "twins_${twinClass.toLowerCase()}"`),
  `${countOf("twins", "cardinality(drop_localities) > 0")} AS "twins_drop"`,
  `${countOf("twins", "cardinality(drop_localities) = 0")} AS "twins_keep"`,
  `${countOf("twins", `drop_defaulted AND NOT EXISTS (SELECT 1 FROM ${q(TWIN_PICKS_CTE)} AS p JOIN ${q("copy_raw")} AS x ON ${pickNamesCopySql("p", "x")} WHERE p.ref = twins.ref)`)} AS "twins_defaulted"`,
  `${countOf("twin_groups", "departments > 1")} AS "twins_cross_department"`,
];
