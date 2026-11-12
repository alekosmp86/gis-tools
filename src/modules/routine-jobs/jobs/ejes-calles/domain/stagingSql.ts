import { physicalColumn, qualifiedName } from "../../actualizar-padron/domain/layouts";
import { cte, jsonArrayOf, q, withClause } from "../../shared/sqlFragments";
import { DETAIL_LIST_LIMIT } from "../../shared/limits";
import { EJES_TABLE_ROLE, STAGING_COLUMN } from "../constants";
import type { EjesLayouts } from "../types";
import { FUENTE_MAP_CTE_NAME, fuenteMapCte, TIPO_MAP_CTE_NAME, tipoMapCte } from "./mappings";

export const INTEGER_PATTERN = "^[0-9]+$";

const DAMAGED_COLUMNS = [STAGING_COLUMN.NOMBRE, STAGING_COLUMN.LOCALIDAD, STAGING_COLUMN.DEPARTAMENTO];

const textOf = (layouts: EjesLayouts, column: string): string =>
  `NULLIF(btrim(s.${physicalColumn(layouts[EJES_TABLE_ROLE.STAGING], column)}::text), '')`;

/** A NULL or empty geometry is not an invalid one: those have their own counts. */
export const validGeometrySql = (geometry: string): string => `COALESCE(ST_IsValid(${geometry}), true)`;

export function stagingRowsCte(layouts: EjesLayouts): string {
  const staging = layouts[EJES_TABLE_ROLE.STAGING];
  const geometry = `s.${physicalColumn(staging, STAGING_COLUMN.GEOM)}`;
  return cte(
    "s",
    [
      "SELECT",
      `${textOf(layouts, STAGING_COLUMN.REFTRAMO)} AS ref,`,
      `${textOf(layouts, STAGING_COLUMN.IDCALLE)} AS idcalle,`,
      `${textOf(layouts, STAGING_COLUMN.TIPO_VIALIDAD)} AS tipo,`,
      `${textOf(layouts, STAGING_COLUMN.FUENTE)} AS fuente,`,
      `${textOf(layouts, STAGING_COLUMN.LOCALIDAD)} AS localidad,`,
      `${textOf(layouts, STAGING_COLUMN.DEPARTAMENTO)} AS departamento,`,
      `(${geometry} IS NULL OR ST_IsEmpty(${geometry})) AS empty_geometry,`,
      `(NOT ${validGeometrySql(geometry)}) AS invalid_geometry,`,
      `(${DAMAGED_COLUMNS.map((column) => `position(chr(65533) in COALESCE(s.${physicalColumn(staging, column)}::text, '')) > 0`).join(" OR ")}) AS damaged_text`,
      `FROM ${qualifiedName(staging)} AS s`,
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
