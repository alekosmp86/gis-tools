import { physicalColumn, qualifiedName, type TableLayout } from "../../actualizar-padron/domain/layouts";
import { literal, q } from "../../shared/sqlFragments";
import { ACCESS_POINT_COLUMN, ACCESS_POINT_DOOR_KEY, ADDRESS_COLUMN, EJES_SRID } from "../constants";
import { outlineGeoJsonSql } from "./geometryMap";

/** The door fields of an access point, by the key the row holds them under and the name the page gives them. */
const DOOR_FIELDS: readonly { key: string; output: string }[] = [
  { key: ACCESS_POINT_DOOR_KEY.NUMBER, output: "number" },
  { key: ACCESS_POINT_DOOR_KEY.LETTER, output: "letter" },
  { key: ACCESS_POINT_DOOR_KEY.KM, output: "km" },
  { key: ACCESS_POINT_DOOR_KEY.CIRCULATION_WAY, output: "circulationWay" },
];

/**
 * The door fields and the point geometry of some access points, by primary key: `$1` is the list of point ids. The geometry is the
 * address's, only when it has the expected SRID (the analysis reads it the same way). A field the table lacks reads as null.
 */
export function splitPointDetailSql(access: TableLayout, address: TableLayout): string {
  const accessId = physicalColumn(access, ACCESS_POINT_COLUMN.ID);
  const addressId = physicalColumn(address, ADDRESS_COLUMN.ID);
  const geometry = physicalColumn(address, ADDRESS_COLUMN.GEOMETRY);
  const pointGeometry = `CASE WHEN ST_SRID(g.${geometry}) = ${EJES_SRID} AND NOT ST_IsEmpty(g.${geometry}) THEN g.${geometry} END`;
  const doors = DOOR_FIELDS.map(({ key, output }) => `to_jsonb(a) ->> ${literal(key)} AS ${q(output)}`);
  return [
    `SELECT a.${accessId}::text AS "pointId", ${doors.join(", ")}, ${outlineGeoJsonSql(pointGeometry)} AS "geometry"`,
    `FROM ${qualifiedName(access)} AS a LEFT JOIN ${qualifiedName(address)} AS g ON g.${addressId} = a.${accessId}`,
    `WHERE a.${accessId} = ANY($1::bigint[])`,
  ].join(" ");
}
