import { PADRON_UNIT } from "../../cargar-padrones/constants";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import { DESTINATION_COLUMN, STAGING_COLUMN } from "../constants";
import type { GeometryMapStagingKey } from "../types";
import { assertTargetSrid, physicalColumn, qualifiedName, type TableLayout } from "./layouts";

export const GEOMETRY_MAP_ITEMS_LIMIT = 6;
export const GEOMETRY_MAP_STATEMENT_TIMEOUT = "20s";
const WGS84_SRID = 4326;
/** Simplification tolerance in metres (the destination SRID is metric): 2 m, wider for large footprints so the payload stays small. */
const TOLERANCE_M = 2;
const LARGE_TOLERANCE_M = 5;
const HUGE_TOLERANCE_M = 20;
const LARGE_AREA_M2 = 1e6;
const HUGE_AREA_M2 = 1e8;
const STAGING_ALIAS = "s";
const MATCHED_CTE = "matched";
const MERGED_ALIAS = "merged";
const MERGED_COLUMN = "u";

/** A referenced padrón (old id or staging key) does not exist or has no usable geometry. Answers 404. */
export class MapFeatureNotFoundError extends Error {
  override readonly name = "MapFeatureNotFoundError";
}

const toleranceSql = (geom: string): string =>
  `CASE WHEN ST_Area(${geom}) > ${HUGE_AREA_M2} THEN ${HUGE_TOLERANCE_M} WHEN ST_Area(${geom}) > ${LARGE_AREA_M2} THEN ${LARGE_TOLERANCE_M} ELSE ${TOLERANCE_M} END`;

/** The outline as GeoJSON in WGS84: simplified in the destination SRID, then transformed. */
const outlineGeoJsonSql = (geom: string): string =>
  `ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(${geom}, ${toleranceSql(geom)}), ${WGS84_SRID}))::json`;

/** Old padrón by id: the destination row with that id, read-only. `$1` is the id. */
export function oldGeometrySql(target: WritableTargetLayout): string {
  const geom = physicalColumn(target, DESTINATION_COLUMN.GEOMETRY);
  return [
    `SELECT ${physicalColumn(target, DESTINATION_COLUMN.TYPE_PADRON)} AS "typePadron",`,
    `${physicalColumn(target, DESTINATION_COLUMN.NUMBER)} AS "number", ${outlineGeoJsonSql(geom)} AS "geojson"`,
    `FROM ${qualifiedName(target)} WHERE ${physicalColumn(target, DESTINATION_COLUMN.ID)} = $1 AND ${geom} IS NOT NULL`,
  ].join(" ");
}

/** Only an URBANO key with a locality is matched by locality too; a RURAL key has none. */
const usesLocality = (key: GeometryMapStagingKey): boolean => key.typePadron === PADRON_UNIT.URBANO && key.locality !== null;

/** The values of the staging lookup: `$1` department, `$2` type, `$3` number, and `$4` locality when the key has one. */
export const stagingLookupValuesOf = (key: GeometryMapStagingKey): string[] =>
  usesLocality(key) && key.locality !== null
    ? [key.department, key.typePadron, key.number, key.locality]
    : [key.department, key.typePadron, key.number];

/** New padrón by staging key: the union of the staging rows that match it, in the destination SRID, then the WGS84 outline. Read-only. */
export function newGeometrySql(staging: TableLayout, target: WritableTargetLayout, key: GeometryMapStagingKey): string {
  assertTargetSrid(target.srid);
  const column = (logical: string): string => `${STAGING_ALIAS}.${physicalColumn(staging, logical)}`;
  const geom = column(STAGING_COLUMN.GEOM);
  const conditions = [
    `upper(${column(STAGING_COLUMN.NOMDEPTO)}) = upper($1)`,
    `${column(STAGING_COLUMN.UNIDADCAT)} = $2`,
    `trunc(${column(STAGING_COLUMN.PADRON)})::text = $3`,
    ...(usesLocality(key) ? [`upper(${column(STAGING_COLUMN.NOMLOCCAT)}) = upper($4)`] : []),
  ];
  const merged = `${MERGED_ALIAS}.${MERGED_COLUMN}`;
  return [
    `WITH ${MATCHED_CTE} AS (`,
    `SELECT ST_CollectionExtract(ST_MakeValid(CASE WHEN ST_SRID(${geom}) = ${target.srid} THEN ${geom} ELSE ST_Transform(${geom}, ${target.srid}) END), 3) AS geom`,
    `FROM ${qualifiedName(staging)} AS ${STAGING_ALIAS} WHERE ${conditions.join(" AND ")})`,
    `SELECT (SELECT count(*) FROM ${MATCHED_CTE})::int AS "matches", ${outlineGeoJsonSql(merged)} AS "geojson"`,
    `FROM (SELECT ST_Union(geom) AS ${MERGED_COLUMN} FROM ${MATCHED_CTE}) AS ${MERGED_ALIAS}`,
  ].join(" ");
}

export const stagingLabelOf = (key: GeometryMapStagingKey): string => {
  const place = key.typePadron === PADRON_UNIT.URBANO && key.locality !== null ? ` · ${key.locality}` : "";
  return `Padrón nuevo ${key.typePadron} ${key.number}${place} (${key.department})`;
};
