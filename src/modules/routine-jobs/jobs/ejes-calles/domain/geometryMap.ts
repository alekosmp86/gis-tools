import { physicalColumn, qualifiedName, type TableLayout } from "../../actualizar-padron/domain/layouts";
import { EJES_SRID, ROAD_SECTION_COLUMN, STAGING_COLUMN } from "../constants";

export const EJES_MAP_ITEMS_LIMIT = 30;
export const EJES_MAP_STATEMENT_TIMEOUT = "20s";
const WGS84_SRID = 4326;
const SIMPLIFY_TOLERANCE_M = 2;
const STAGING_ALIAS = "s";

/** The outline as GeoJSON in WGS84: simplified in the metric SRID of the ejes, then transformed. */
const outlineGeoJsonSql = (geometry: string): string =>
  `ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(${geometry}, ${SIMPLIFY_TOLERANCE_M}), ${WGS84_SRID}))::json`;

/** An old section by its `reftramo_ideuy`. `$1` is the reference; the row has an outline and the street id. */
export function oldSectionOutlineSql(roadSection: TableLayout): string {
  const geometry = physicalColumn(roadSection, ROAD_SECTION_COLUMN.GEOMETRY);
  return [
    `SELECT ${physicalColumn(roadSection, ROAD_SECTION_COLUMN.CIRCULATION_WAY)} AS "idcalle", ${outlineGeoJsonSql(geometry)} AS "geojson"`,
    `FROM ${qualifiedName(roadSection)}`,
    `WHERE ${physicalColumn(roadSection, ROAD_SECTION_COLUMN.REFTRAMO)} = $1 AND ${geometry} IS NOT NULL`,
  ].join(" ");
}

/**
 * A new section by its staging `reftramo`. `$1` is the reference. Several staging rows can share a `reftramo` (one per locality or
 * department the section crosses) with the same geometry, so one of them is enough.
 */
export function newSectionOutlineSql(staging: TableLayout): string {
  const column = (logical: string): string => `${STAGING_ALIAS}.${physicalColumn(staging, logical)}`;
  const geometry = `ST_SetSRID(${column(STAGING_COLUMN.GEOM)}, ${EJES_SRID})`;
  return [
    `SELECT ${column(STAGING_COLUMN.IDCALLE)} AS "idcalle", ${outlineGeoJsonSql(geometry)} AS "geojson"`,
    `FROM ${qualifiedName(staging)} AS ${STAGING_ALIAS}`,
    `WHERE trim(${column(STAGING_COLUMN.REFTRAMO)}::text) = $1 AND ${column(STAGING_COLUMN.GEOM)} IS NOT NULL`,
    `AND NOT ST_IsEmpty(${column(STAGING_COLUMN.GEOM)}) LIMIT 1`,
  ].join(" ");
}
