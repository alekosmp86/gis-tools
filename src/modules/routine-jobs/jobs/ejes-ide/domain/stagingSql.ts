import { physicalColumn, qualifiedName, type TableLayout } from "../../actualizar-padron/domain/layouts";
import { cte, jsonArrayOf, q, withClause } from "../../shared/sqlFragments";
import { DETAIL_LIST_LIMIT } from "../../shared/limits";
import { ACCESS_POINT_COLUMN, EJES_TABLE_ROLE, EJES_STAGING_COLUMN, GEOMETRY_TOLERANCE_M, MIN_SECTION_LENGTH_M } from "../constants";
import type { EjesLayouts } from "../types";
import { col, scopedTable } from "./layoutSql";
import { FUENTE_MAP_CTE_NAME, fuenteMapCte, TIPO_MAP_CTE_NAME, tipoMapCte } from "./mappings";

export const INTEGER_PATTERN = "^[0-9]+$";

const DAMAGED_COLUMNS = [EJES_STAGING_COLUMN.NOMBRE, EJES_STAGING_COLUMN.LOCALIDAD, EJES_STAGING_COLUMN.DEPARTAMENTO];

/** Integer text without leading zeros, so '0123' and '123' compare equal; other text is kept and never cast. */
export const canonicalIntegerSql = (text: string): string =>
  `CASE WHEN ${text} ~ '${INTEGER_PATTERN}' THEN (${text})::numeric::text ELSE ${text} END`;

/** A reftramo or idcalle as the analysis compares it: trimmed, and canonical when it is an integer. */
export const canonicalTextSql = (expression: string): string => canonicalIntegerSql(`NULLIF(btrim(${expression}::text), '')`);

const textOf = (layouts: EjesLayouts, column: string): string =>
  `NULLIF(btrim(s.${physicalColumn(layouts[EJES_TABLE_ROLE.STAGING], column)}::text), '')`;

/** The `reftramo` of an access point, in the same canonical form as the sections it points to. */
export const accessPointRefSql = (layouts: EjesLayouts): string =>
  canonicalTextSql(`a.${col(layouts, "ACCESS_POINT", ACCESS_POINT_COLUMN.ROAD_SECTION)}`);

const SHORT_UNHELD_CTE_NAME = "short_unheld";

/**
 * The references of the short staging sections (below `MIN_SECTION_LENGTH_M`) that no access point holds. A hash join builds it once per
 * statement, so a row tests membership in this small set instead of probing the access points.
 */
export const shortUnheldCteOf = (staging: TableLayout, accessPoints: TableLayout): string => {
  const geometry = `s.${physicalColumn(staging, EJES_STAGING_COLUMN.GEOM)}`;
  const reference = canonicalTextSql(`s.${physicalColumn(staging, EJES_STAGING_COLUMN.REFTRAMO)}`);
  const pointColumn = `a.${physicalColumn(accessPoints, ACCESS_POINT_COLUMN.ROAD_SECTION)}`;
  return cte(
    SHORT_UNHELD_CTE_NAME,
    [
      "SELECT x.ref FROM",
      `(SELECT DISTINCT ${reference} AS ref FROM ${qualifiedName(staging)} AS s WHERE ${geometry} IS NOT NULL AND NOT ST_IsEmpty(${geometry}) AND ST_Length(${geometry}) < ${MIN_SECTION_LENGTH_M}) AS x`,
      `LEFT JOIN (SELECT DISTINCT ${canonicalTextSql(pointColumn)} AS ref FROM ${qualifiedName(accessPoints)} AS a WHERE ${pointColumn} IS NOT NULL) AS p ON p.ref = x.ref`,
      "WHERE x.ref IS NOT NULL AND p.ref IS NULL",
    ].join(" ")
  );
};

export const shortUnheldCte = (layouts: EjesLayouts): string =>
  shortUnheldCteOf(layouts[EJES_TABLE_ROLE.STAGING], layouts[EJES_TABLE_ROLE.ACCESS_POINT]);

/** Needs `shortUnheldCte` in the same statement, before the first use. */
const hasAccessPointsSql = (reference: string): string =>
  `COALESCE(${reference} IS NOT NULL AND ${reference} NOT IN (SELECT ref FROM ${q(SHORT_UNHELD_CTE_NAME)}), false)`;

/**
 * Valid for every rule: empty, or valid, not collapsed, and at least `MIN_SECTION_LENGTH_M` long unless its canonical `reference` holds access points.
 * The access points are read only for a short section (CASE), so long sections never touch them. Any other row is discarded from every rule.
 */
const validGeometrySql =(geometry: string, reference: string): string => {
  const length = `ST_Length(${geometry})`;
  const longEnoughOrHeld = `CASE WHEN ${length} >= ${MIN_SECTION_LENGTH_M} THEN true ELSE ${hasAccessPointsSql(reference)} END`;
  return `COALESCE(ST_IsEmpty(${geometry}) OR (ST_IsValid(${geometry}) AND ${length} >= ${GEOMETRY_TOLERANCE_M} AND (${longEnoughOrHeld})), true)`;
};

/** A staging row every rule reads: geometry present and valid (`validGeometrySql`), reference an integer. */
export const keptStagingRowSql = (geometry: string, reference: string): string =>
  `${geometry} IS NOT NULL AND NOT ST_IsEmpty(${geometry}) AND ${validGeometrySql(geometry, reference)} AND ${reference} ~ '${INTEGER_PATTERN}'`;

function stagingRowsCte(layouts: EjesLayouts): string {
  const staging = layouts[EJES_TABLE_ROLE.STAGING];
  const geometry = `s.${physicalColumn(staging, EJES_STAGING_COLUMN.GEOM)}`;
  const reference = canonicalTextSql(`s.${physicalColumn(staging, EJES_STAGING_COLUMN.REFTRAMO)}`);
  return cte(
    "s",
    [
      "SELECT",
      `${reference} AS ref,`,
      `${textOf(layouts, EJES_STAGING_COLUMN.IDCALLE)} AS idcalle,`,
      `${textOf(layouts, EJES_STAGING_COLUMN.TIPO_VIALIDAD)} AS tipo,`,
      `${textOf(layouts, EJES_STAGING_COLUMN.FUENTE)} AS fuente,`,
      `${textOf(layouts, EJES_STAGING_COLUMN.LOCALIDAD)} AS localidad,`,
      `${textOf(layouts, EJES_STAGING_COLUMN.DEPARTAMENTO)} AS departamento,`,
      `(${geometry} IS NULL OR ST_IsEmpty(${geometry})) AS empty_geometry,`,
      `(NOT ${validGeometrySql(geometry, reference)}) AS invalid_geometry,`,
      `(${DAMAGED_COLUMNS.map((column) => `position(chr(65533) in COALESCE(s.${physicalColumn(staging, column)}::text, '')) > 0`).join(" OR ")}) AS damaged_text`,
      `FROM ${scopedTable(layouts, "STAGING")} AS s`,
    ].join(" ")
  );
}

const invalidListSql = (): string =>
  jsonArrayOf(
    [
      `SELECT x.ref AS "ref", x.idcalle AS "idcalle", x.localidad AS "localidad", x.departamento AS "departamento" FROM ${q("s")} AS x`,
      `WHERE x.invalid_geometry ORDER BY x.ref, x.localidad LIMIT ${DETAIL_LIST_LIMIT}`,
    ].join(" "),
    "invalid_geometry_list"
  );

function unknownValuesSql(column: string, mapName: string): string {
  return jsonArrayOf(
    [
      `SELECT x.${column} AS "value", count(*) AS "rows" FROM ${q("s")} AS x`,
      `WHERE NOT EXISTS (SELECT 1 FROM ${q(mapName)} AS m WHERE m.label = x.${column})`,
      `GROUP BY x.${column} ORDER BY count(*) DESC, x.${column} LIMIT ${DETAIL_LIST_LIMIT}`,
    ].join(" "),
    `unknown_${column}`
  );
}

const unknownRowsSql = (column: string, mapName: string): string =>
  `(SELECT count(*) FROM ${q("s")} AS x WHERE NOT EXISTS (SELECT 1 FROM ${q(mapName)} AS m WHERE m.label = x.${column}))`;

export function buildStagingChecksSql(layouts: EjesLayouts): string {
  const ctes = [
    shortUnheldCte(layouts),
    stagingRowsCte(layouts),
    tipoMapCte(),
    fuenteMapCte(),
    cte(
      "dup",
      `SELECT ref, count(*) AS rows FROM ${q("s")} WHERE ref IS NOT NULL GROUP BY ref HAVING count(*) > 1`
    ),
  ];
  return [
    withClause(ctes),
    "SELECT",
    `(SELECT count(*) FROM ${q("s")}) AS "rows",`,
    `(SELECT count(DISTINCT ref) FROM ${q("s")}) AS "distinct_refs",`,
    `(SELECT count(*) FROM ${q("dup")}) AS "repeated_groups",`,
    `(SELECT COALESCE(sum(rows), 0) FROM ${q("dup")}) AS "repeated_rows",`,
    `(SELECT count(*) FROM ${q("s")} WHERE ref IS NULL OR ref !~ '${INTEGER_PATTERN}') AS "non_integer_refs",`,
    `(SELECT count(*) FROM ${q("s")} WHERE empty_geometry) AS "empty_geometry",`,
    `(SELECT count(*) FROM ${q("s")} WHERE invalid_geometry) AS "invalid_geometry_rows",`,
    `(SELECT count(DISTINCT ref) FROM ${q("s")} WHERE invalid_geometry) AS "invalid_geometry_refs",`,
    `${invalidListSql()} AS "invalid_geometries",`,
    `(SELECT count(*) FROM ${q("s")} WHERE damaged_text) AS "damaged_text_rows",`,
    `(SELECT count(*) FROM ${q("s")} WHERE idcalle IS NULL) AS "empty_idcalle",`,
    `${unknownRowsSql("tipo", TIPO_MAP_CTE_NAME)} AS "unknown_tipo_rows",`,
    `${unknownRowsSql("fuente", FUENTE_MAP_CTE_NAME)} AS "unknown_fuente_rows",`,
    `${unknownValuesSql("tipo", TIPO_MAP_CTE_NAME)} AS "unknown_tipos",`,
    `${unknownValuesSql("fuente", FUENTE_MAP_CTE_NAME)} AS "unknown_fuentes"`,
  ].join("\n");
}
