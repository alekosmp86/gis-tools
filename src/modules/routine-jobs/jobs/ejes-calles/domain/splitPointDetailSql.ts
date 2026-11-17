import { physicalColumn, qualifiedName, type TableLayout } from "../../actualizar-padron/domain/layouts";
import { literal, q } from "../../shared/sqlFragments";
import { ACCESS_POINT_COLUMN, ACCESS_POINT_DOOR_KEY, ADDRESS_COLUMN, CIRCULATION_WAY_COLUMN, EJES_SRID, ROAD_SECTION_COLUMN } from "../constants";
import { outlineGeoJsonSql } from "./geometryMap";
import { canonicalTextSql } from "./stagingSql";

/** The door fields of an access point, by the key the row holds them under and the name the page gives them. */
const DOOR_FIELDS: readonly { key: string; output: string }[] = [
  { key: ACCESS_POINT_DOOR_KEY.NUMBER, output: "number" },
  { key: ACCESS_POINT_DOOR_KEY.LETTER, output: "letter" },
  { key: ACCESS_POINT_DOOR_KEY.KM, output: "km" },
  { key: ACCESS_POINT_DOOR_KEY.CIRCULATION_WAY, output: "circulationWay" },
];

/**
 * The door fields, the street (`idcalle`, canonical) and the point geometry of some access points, by primary key: `$1` is the list of
 * point ids. The geometry is the address's, only when it has the expected SRID (the analysis reads it the same way). A field the table
 * lacks reads as null.
 */
export function splitPointDetailSql(access: TableLayout, address: TableLayout): string {
  const accessId = physicalColumn(access, ACCESS_POINT_COLUMN.ID);
  const addressId = physicalColumn(address, ADDRESS_COLUMN.ID);
  const geometry = physicalColumn(address, ADDRESS_COLUMN.GEOMETRY);
  const pointGeometry = `CASE WHEN ST_SRID(g.${geometry}) = ${EJES_SRID} AND NOT ST_IsEmpty(g.${geometry}) THEN g.${geometry} END`;
  const doors = DOOR_FIELDS.map(({ key, output }) => `to_jsonb(a) ->> ${literal(key)} AS ${q(output)}`);
  const street = canonicalTextSql(`(to_jsonb(a) ->> ${literal(ACCESS_POINT_DOOR_KEY.CIRCULATION_WAY)})`);
  return [
    `SELECT a.${accessId}::text AS "pointId", ${doors.join(", ")}, ${street} AS "idcalle", ${outlineGeoJsonSql(pointGeometry)} AS "geometry"`,
    `FROM ${qualifiedName(access)} AS a LEFT JOIN ${qualifiedName(address)} AS g ON g.${addressId} = a.${accessId}`,
    `WHERE a.${accessId} = ANY($1::bigint[])`,
  ].join(" ");
}

/** The street (`idcalle`, canonical) of the old section with the `reftramo` `$1`; no row when the section is not found. */
export function oldSectionStreetSql(roadSection: TableLayout): string {
  const street = canonicalTextSql(`r.${physicalColumn(roadSection, ROAD_SECTION_COLUMN.CIRCULATION_WAY)}`);
  return [
    `SELECT ${street} AS "idcalle"`,
    `FROM ${qualifiedName(roadSection)} AS r`,
    `WHERE r.${physicalColumn(roadSection, ROAD_SECTION_COLUMN.REFTRAMO)} = $1`,
    `ORDER BY r.${physicalColumn(roadSection, ROAD_SECTION_COLUMN.ID)} LIMIT 1`,
  ].join(" ");
}

/**
 * The name of each street of `$1` (a text array of canonical `idcalle`s), by `circulation_way.id_calle`: the lowest `id` of the ways of the
 * street names it, as the address view does. One row per street; the name is null when no way of it has one.
 */
export function circulationWayNamesSql(circulationWay: TableLayout): string {
  const idCalle = canonicalTextSql(`w.${physicalColumn(circulationWay, CIRCULATION_WAY_COLUMN.CALLE)}`);
  const name = `NULLIF(btrim(w.${physicalColumn(circulationWay, CIRCULATION_WAY_COLUMN.NAME)}), '')`;
  return [
    `SELECT DISTINCT ON (k.idcalle) k.idcalle AS "idcalle", ${name} AS "name"`,
    `FROM unnest($1::text[]) AS k(idcalle)`,
    `LEFT JOIN ${qualifiedName(circulationWay)} AS w ON ${idCalle} = k.idcalle`,
    `ORDER BY k.idcalle, w.${physicalColumn(circulationWay, CIRCULATION_WAY_COLUMN.ID)}`,
  ].join(" ");
}
