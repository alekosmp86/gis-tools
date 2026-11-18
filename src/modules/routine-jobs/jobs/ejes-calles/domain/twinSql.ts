import { cte, q } from "../../shared/sqlFragments";
import {
  EJES_SRID,
  LOCALITIES_COLUMN,
  PADRON_COLUMN,
  PADRON_TYPE,
  RURAL_LOCALITY_SUFFIX,
  EJES_STAGING_COLUMN,
  TWIN_CLASS,
  TWIN_NEAR_MIN_LENGTH_M,
  TWIN_PADRON_DISTANCE_M,
} from "../constants";
import type { EjesLayouts } from "../types";
import { col, countOf, listOf, table, trimmed } from "./layoutSql";
import { canonicalTextSql, INTEGER_PATTERN, validGeometrySql } from "./stagingSql";

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
        `FROM ${table(layouts, "STAGING")} AS s WHERE ${geometry} IS NOT NULL AND NOT ST_IsEmpty(${geometry}) AND ${validGeometrySql(geometry)}`,
        `AND ${reference} ~ '${INTEGER_PATTERN}'`,
      ].join(" ")
    ),
    cte(
      "twin_groups",
      [
        "SELECT t.ref, min(t.idcalle) AS idcalle, min(t.departamento) AS department, count(DISTINCT t.departamento) AS departments,",
        "count(DISTINCT t.localidad) AS locality_count,",
        "array_agg(DISTINCT t.localidad ORDER BY t.localidad) FILTER (WHERE t.localidad IS NOT NULL) AS localities,",
        `(array_agg(t.geom))[1] AS geom FROM ${q("twin_raw")} AS t GROUP BY t.ref`,
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

const ruralNamed = (locality: string): string => `upper(btrim(${locality})) LIKE '%${RURAL_LOCALITY_SUFFIX}'`;

/**
 * The class rule of ET-10 (the base drop, before the single-copy step of `twinDropCaseSql`). `alias` names a relation with
 * `class`, `localities` (text[]) and `inside_localities` (text[]). URBAN drops the rural-named copies; RURAL and NEITHER with
 * no inside polygon keep the first rural-named copy; BOTH keeps the winner; NEITHER with an inside polygon keeps the copies
 * whose name is in it.
 */
function twinClassDropSql(alias: string): string {
  const field = (name: string): string => `${alias}.${name}`;
  const localities = field("localities");
  const hasLocality = (rural: boolean): string =>
    `EXISTS (SELECT 1 FROM unnest(${localities}) AS h WHERE ${rural ? "" : "NOT "}${ruralNamed("h")})`;
  const noInside = `cardinality(${field("inside_localities")}) = 0`;
  const insideName = (locality: string): string => `upper(btrim(${locality})) = ANY(${field("inside_localities")})`;
  const isNeither = `${field("class")} = '${TWIN_CLASS.NEITHER}'`;
  const isBoth = `${field("class")} = '${TWIN_CLASS.BOTH}'`;
  const bothWinner = `(SELECT r FROM unnest(${localities}) AS r ORDER BY array_position(${field("inside_localities")}, upper(btrim(r))) ASC NULLS LAST, (${ruralNamed("r")}) ASC, r ASC LIMIT 1)`;
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
 * The localities of a twin row to drop (ET-10, ET-19). `alias` names a relation with `class`, `localities` (text[]) and
 * `inside_localities` (text[], the upper-cased names of the locality polygons the section intersects, ordered by overlap
 * length descending, so the first is the longest; filled for every class). The base is the class rule (`twinClassDropSql`).
 * Single copy: when more than one copy remains after the base and one remaining copy is in `inside_localities`, the winner
 * among the remaining copies (the highest rank in `inside_localities`, else the non-rural-named, else the first by name) stays
 * and every other remaining copy is dropped too. Otherwise the base is the drop. It never drops all the localities.
 */
export function twinDropCaseSql(alias: string): string {
  const field = (name: string): string => `${alias}.${name}`;
  const localities = field("localities");
  const inside = field("inside_localities");
  const winner = `(SELECT r FROM unnest(twin_drop_rest.remaining) AS r ORDER BY array_position(${inside}, upper(btrim(r))) ASC NULLS LAST, (${ruralNamed("r")}) ASC, r ASC LIMIT 1)`;
  return [
    `(SELECT CASE WHEN cardinality(twin_drop_rest.remaining) > 1 AND EXISTS (SELECT 1 FROM unnest(twin_drop_rest.remaining) AS h WHERE upper(btrim(h)) = ANY(${inside}))`,
    `THEN ARRAY(SELECT l FROM unnest(${localities}) AS l WHERE l = ANY(twin_drop_base.base) OR l <> ${winner} ORDER BY l)`,
    "ELSE twin_drop_base.base END",
    `FROM (SELECT ${twinClassDropSql(alias)} AS base) AS twin_drop_base,`,
    `LATERAL (SELECT ARRAY(SELECT l FROM unnest(${localities}) AS l WHERE NOT l = ANY(twin_drop_base.base)) AS remaining) AS twin_drop_rest)`,
  ].join(" ");
}

function insideLocalitiesSql(layouts: EjesLayouts): string {
  const locality = (logical: string): string => `l.${col(layouts, "LOCALITIES", logical)}`;
  return [
    `ARRAY(SELECT t.n FROM (SELECT upper(btrim(${locality(LOCALITIES_COLUMN.NAME)}::text)) AS n,`,
    `sum(ST_Length(ST_Intersection(k.geom, ST_MakeValid(${locality(LOCALITIES_COLUMN.GEOM)})))) AS len FROM ${table(layouts, "LOCALITIES")} AS l`,
    `WHERE ${locality(LOCALITIES_COLUMN.NAME)} IS NOT NULL AND ST_Intersects(${locality(LOCALITIES_COLUMN.GEOM)}, k.geom) GROUP BY 1) AS t ORDER BY t.len DESC, t.n) AS inside_localities`,
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
    cte("twin_located", `SELECT k.*, ${insideLocalitiesSql(layouts)} FROM ${q("twin_classed")} AS k`),
    cte("twins", `SELECT c.*, ${twinDropCaseSql("c")} AS drop_localities FROM ${q("twin_located")} AS c`),
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
  `${countOf("twin_groups", "departments > 1")} AS "twins_cross_department"`,
];
