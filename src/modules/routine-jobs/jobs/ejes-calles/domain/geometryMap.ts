import { physicalColumn, qualifiedName, type TableLayout } from "../../actualizar-padron/domain/layouts";
import { GEOMETRY_MAP_ROLE } from "../../actualizar-padron/constants";
import {
  ACCESS_POINT_COLUMN,
  ADDRESS_COLUMN,
  DEPARTMENTS_COLUMN,
  EJES_SRID,
  LOCALITIES_COLUMN,
  MANUAL_CANDIDATES_LIMIT,
  PADRON_COLUMN,
  PIECE_COVER_TOLERANCE_M,
  ROAD_SECTION_COLUMN,
  EJES_STAGING_COLUMN,
  TWIN_PADRON_DISTANCE_M,
} from "../constants";
import { trimmed } from "./layoutSql";
import { canonicalIntegerSql, canonicalTextSql, keptStagingRowSql, shortUnheldCteOf } from "./stagingSql";

export const EJES_MAP_ITEMS_LIMIT = 30;
export const EJES_MAP_STATEMENT_TIMEOUT = "20s";
export const EJES_MAP_ROLE = {
  ...GEOMETRY_MAP_ROLE,
  ZONE: "zone",
  LOCALITY: "locality",
  DEPARTMENT: "department",
  ACCESS: "access",
} as const;
const WGS84_SRID = 4326;
const SIMPLIFY_TOLERANCE_M = 2;
const STAGING_ALIAS = "s";

/** The outline as GeoJSON in WGS84: simplified in the metric SRID of the ejes, then transformed. */
export const outlineGeoJsonSql = (geometry: string): string =>
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
 * department the section crosses) with the same geometry, so one of them is enough. With `byLocality`, `$2` is the trimmed
 * `localidad` and the record of that copy is read.
 */
export function newSectionOutlineSql(staging: TableLayout, byLocality = false): string {
  const column = (logical: string): string => `${STAGING_ALIAS}.${physicalColumn(staging, logical)}`;
  const geometry = `ST_SetSRID(${column(EJES_STAGING_COLUMN.GEOM)}, ${EJES_SRID})`;
  return [
    `SELECT ${column(EJES_STAGING_COLUMN.IDCALLE)} AS "idcalle", ${outlineGeoJsonSql(geometry)} AS "geojson"`,
    `FROM ${qualifiedName(staging)} AS ${STAGING_ALIAS}`,
    `WHERE ${canonicalIntegerSql(`trim(${column(EJES_STAGING_COLUMN.REFTRAMO)}::text)`)} = $1 AND ${column(EJES_STAGING_COLUMN.GEOM)} IS NOT NULL`,
    `AND NOT ST_IsEmpty(${column(EJES_STAGING_COLUMN.GEOM)})`,
    byLocality ? `AND trim(${column(EJES_STAGING_COLUMN.LOCALIDAD)}::text) = $2` : "",
    "LIMIT 1",
  ].join(" ");
}

/** The geometry of a new section in the ejes SRID, as one row. `$1` is the staging `reftramo`; its staging rows share the geometry. */
function sectionGeometrySql(staging: TableLayout): string {
  const column = (logical: string): string => `${STAGING_ALIAS}.${physicalColumn(staging, logical)}`;
  return [
    `SELECT ST_SetSRID(${column(EJES_STAGING_COLUMN.GEOM)}, ${EJES_SRID}) AS geom FROM ${qualifiedName(staging)} AS ${STAGING_ALIAS}`,
    `WHERE ${canonicalIntegerSql(`trim(${column(EJES_STAGING_COLUMN.REFTRAMO)}::text)`)} = $1 AND ${column(EJES_STAGING_COLUMN.GEOM)} IS NOT NULL`,
    `AND NOT ST_IsEmpty(${column(EJES_STAGING_COLUMN.GEOM)}) LIMIT 1`,
  ].join(" ");
}

/**
 * The padrones of one type within `TWIN_PADRON_DISTANCE_M` of a new section, dissolved into one outline. `$1` is the staging
 * `reftramo`, `$2` the padron type. No padron near, or no such section: no row.
 */
export function zoneOutlineSql(staging: TableLayout, padrones: TableLayout): string {
  const geometry = `p.${physicalColumn(padrones, PADRON_COLUMN.GEOMETRY)}`;
  return [
    `SELECT ${outlineGeoJsonSql(`ST_Union(ST_MakeValid(${geometry}))`)} AS "geojson"`,
    `FROM ${qualifiedName(padrones)} AS p`,
    `WHERE upper(btrim(p.${physicalColumn(padrones, PADRON_COLUMN.TYPE)}::text)) = $2::text`,
    `AND ST_DWithin(${geometry}, (${sectionGeometrySql(staging)}), ${TWIN_PADRON_DISTANCE_M}) HAVING count(*) > 0`,
  ].join(" ");
}

/**
 * The locality polygons a new section crosses (`ST_Intersects`, as the twin rule): one row each, with the name, the length of the section
 * inside the polygon, the section length and the outline. `$1` is the staging `reftramo`; the longest overlap comes first.
 */
export function localityOverlapSql(staging: TableLayout, localities: TableLayout): string {
  const polygon = `l.${physicalColumn(localities, LOCALITIES_COLUMN.GEOM)}`;
  const name = `l.${physicalColumn(localities, LOCALITIES_COLUMN.NAME)}`;
  return [
    `SELECT btrim(${name}::text) AS "name", ST_Length(ST_Intersection(k.geom, ST_MakeValid(${polygon}))) AS "overlap",`,
    `ST_Length(k.geom) AS "length", ${outlineGeoJsonSql(`ST_MakeValid(${polygon})`)} AS "geojson"`,
    `FROM ${qualifiedName(localities)} AS l CROSS JOIN (${sectionGeometrySql(staging)}) AS k`,
    `WHERE ${name} IS NOT NULL AND ST_Intersects(${polygon}, k.geom)`,
    `ORDER BY "overlap" DESC, "name"`,
  ].join(" ");
}

/** The department polygons a new section crosses (`ST_Intersects`, as the twin rule): one row each, with the name and the outline. `$1` is the staging `reftramo`. */
export function departmentOutlineSql(staging: TableLayout, departments: TableLayout): string {
  const polygon = `d.${physicalColumn(departments, DEPARTMENTS_COLUMN.GEOM)}`;
  const name = `d.${physicalColumn(departments, DEPARTMENTS_COLUMN.NAME)}`;
  return [
    `SELECT btrim(${name}::text) AS "name", ${outlineGeoJsonSql(`ST_MakeValid(${polygon})`)} AS "geojson"`,
    `FROM ${qualifiedName(departments)} AS d CROSS JOIN (${sectionGeometrySql(staging)}) AS k`,
    `WHERE ${name} IS NOT NULL AND ST_Intersects(${polygon}, k.geom)`,
    `ORDER BY "name"`,
  ].join(" ");
}

/**
 * The candidate new sections of a manual split (EJS-22): the kept staging sections within `$2` metres of the old section `$1`, one row
 * per `reftramo` that carto does not hold yet, nearest first, at most MANUAL_CANDIDATES_LIMIT. The bounding box filter (`&&`) and
 * `ST_DWithin` use the staging geometry index; the same street only unless `otherStreets`. The figures are the side panel's: the
 * candidate's length, its metres within PIECE_COVER_TOLERANCE_M of the old section, the old section's covered metres and percent, the distance.
 */
export function candidateSectionsSql(staging: TableLayout, roadSection: TableLayout, accessPoints: TableLayout, otherStreets: boolean): string {
  const stagingColumn = (logical: string): string => `${STAGING_ALIAS}.${physicalColumn(staging, logical)}`;
  const roadColumn = (logical: string): string => `r.${physicalColumn(roadSection, logical)}`;
  const reference = canonicalTextSql(stagingColumn(EJES_STAGING_COLUMN.REFTRAMO));
  const street = canonicalTextSql(stagingColumn(EJES_STAGING_COLUMN.IDCALLE));
  const geometry = stagingColumn(EJES_STAGING_COLUMN.GEOM);
  const roadGeometry = roadColumn(ROAD_SECTION_COLUMN.GEOMETRY);
  const roadReference = canonicalTextSql(`x.${physicalColumn(roadSection, ROAD_SECTION_COLUMN.REFTRAMO)}`);
  const tolerance = PIECE_COVER_TOLERANCE_M;
  const oldCovered = `ST_Length(ST_Intersection(o.geom, ST_Buffer(f.geom, ${tolerance})))`;
  return [
    `WITH ${shortUnheldCteOf(staging, accessPoints)}, old AS (SELECT`,
    `${canonicalTextSql(roadColumn(ROAD_SECTION_COLUMN.CIRCULATION_WAY))} AS idcalle, ${roadGeometry} AS geom`,
    `FROM ${qualifiedName(roadSection)} AS r WHERE ${roadColumn(ROAD_SECTION_COLUMN.REFTRAMO)} = $1`,
    `AND ${roadGeometry} IS NOT NULL AND NOT ST_IsEmpty(${roadGeometry}) LIMIT 1),`,
    "near AS (SELECT",
    `${reference} AS ref, ${street} AS idcalle, ${trimmed(stagingColumn(EJES_STAGING_COLUMN.NOMBRE))} AS name,`,
    `${trimmed(stagingColumn(EJES_STAGING_COLUMN.LOCALIDAD))} AS localidad, ${geometry} AS geom`,
    `FROM ${qualifiedName(staging)} AS ${STAGING_ALIAS}, old AS o`,
    `WHERE ${keptStagingRowSql(geometry, reference)}`,
    `AND ${geometry} && ST_Expand(o.geom, $2::float8) AND ST_DWithin(${geometry}, o.geom, $2::float8)`,
    otherStreets ? "" : `AND ${street} = o.idcalle`,
    "),",
    "fresh AS (SELECT n.ref, min(n.idcalle) AS idcalle, min(n.name) AS name, string_agg(DISTINCT n.localidad, ', ') AS localities, (array_agg(n.geom))[1] AS geom",
    `FROM near AS n LEFT JOIN (SELECT DISTINCT ${roadReference} AS ref FROM ${qualifiedName(roadSection)} AS x WHERE ${roadReference} IN (SELECT ref FROM near)) AS c ON c.ref = n.ref`,
    "WHERE c.ref IS NULL GROUP BY n.ref)",
    "SELECT f.ref, f.idcalle, f.name, f.localities,",
    `ROUND(ST_Length(f.geom)::numeric, 1)::float8 AS length,`,
    `ROUND(ST_Length(ST_Intersection(f.geom, ST_Buffer(o.geom, ${tolerance})))::numeric, 1)::float8 AS near_length,`,
    `ROUND(${oldCovered}::numeric, 1)::float8 AS covered_length,`,
    `ROUND((100 * ${oldCovered} / NULLIF(ST_Length(o.geom), 0))::numeric, 1)::float8 AS covered_percent,`,
    `ROUND(ST_Distance(f.geom, o.geom)::numeric, 1)::float8 AS distance,`,
    `${outlineGeoJsonSql(`ST_SetSRID(f.geom, ${EJES_SRID})`)} AS geojson`,
    `FROM fresh AS f CROSS JOIN old AS o ORDER BY distance, f.ref LIMIT ${MANUAL_CANDIDATES_LIMIT}`,
  ]
    .filter((part) => part !== "")
    .join(" ");
}

/** The access points of an old section (`$1`, its `reftramo`) with the WGS84 geometry of their address (`carto.address` by the point's id). */
export function accessPointOutlinesSql(accessPoints: TableLayout, addresses: TableLayout): string {
  const point = (logical: string): string => `a.${physicalColumn(accessPoints, logical)}`;
  const addressGeometry = `g.${physicalColumn(addresses, ADDRESS_COLUMN.GEOMETRY)}`;
  return [
    `SELECT ${point(ACCESS_POINT_COLUMN.ID)}::text AS "id",`,
    `ST_AsGeoJSON(ST_Transform(ST_SetSRID(${addressGeometry}, ${EJES_SRID}), ${WGS84_SRID}))::json AS "geojson"`,
    `FROM ${qualifiedName(accessPoints)} AS a JOIN ${qualifiedName(addresses)} AS g ON g.${physicalColumn(addresses, ADDRESS_COLUMN.ID)} = ${point(ACCESS_POINT_COLUMN.ID)}`,
    `WHERE ${canonicalTextSql(point(ACCESS_POINT_COLUMN.ROAD_SECTION))} = $1::text AND ${addressGeometry} IS NOT NULL AND NOT ST_IsEmpty(${addressGeometry})`,
    `ORDER BY ${point(ACCESS_POINT_COLUMN.ID)}`,
  ].join(" ");
}
