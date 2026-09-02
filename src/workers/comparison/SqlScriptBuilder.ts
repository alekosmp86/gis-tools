/**
 * SqlScriptBuilder.ts
 * Object-Oriented Builder for high-speed, compact SQL generation (INSERT, UPDATE) and PostGIS expressions.
 */

import { roundGisCoordinate } from "@/constants/gisConstants";
import { cleanValue } from "@/utils/common/GisStringSanitizer";

export class SqlScriptBuilder {
  private readonly dbSchemaName: string;
  private readonly dbTableName: string;
  private readonly dbColumnTypes?: Record<string, string>;
  private readonly targetSrid: number;

  constructor(
    dbSchemaName: string,
    dbTableName: string,
    dbColumnTypes?: Record<string, string>,
    targetSrid: number = 4326
  ) {
    this.dbSchemaName = dbSchemaName;
    this.dbTableName = dbTableName;
    this.dbColumnTypes = dbColumnTypes;
    this.targetSrid = targetSrid > 0 ? targetSrid : 4326;
  }

  private isNumericColumnType(dataType?: string): boolean {
    if (!dataType) return false;
    const lowerType = dataType.toLowerCase();
    return (
      lowerType.includes("int") ||
      lowerType.includes("num") ||
      lowerType.includes("decimal") ||
      lowerType.includes("float") ||
      lowerType.includes("double") ||
      lowerType.includes("real") ||
      lowerType.includes("serial")
    );
  }

  public formatSqlValue(value: unknown, columnName?: string): string {
    if (value === null || value === undefined) return "NULL";
    const cleaned = cleanValue(value);
    if (cleaned === "") return "NULL";

    const dataType = columnName && this.dbColumnTypes ? this.dbColumnTypes[columnName] : undefined;

    if (dataType) {
      if (this.isNumericColumnType(dataType)) {
        const parsedNumber = Number(cleaned);
        if (!isNaN(parsedNumber)) return cleaned;
      }
      return `'${cleaned.replace(/'/g, "''")}'`;
    }

    if (typeof value === "number" && !isNaN(value)) {
      return cleaned;
    }

    return `'${cleaned.replace(/'/g, "''")}'`;
  }

  public formatWhereCondition(columnName: string, value: unknown): string {
    const sqlValue = this.formatSqlValue(value, columnName);
    if (sqlValue === "NULL") {
      return `"${columnName}" IS NULL`;
    }
    return `"${columnName}" = ${sqlValue}`;
  }

  /**
   * Serializes a geometry to compact GeoJSON string with rounded coordinates (6 decimals),
   * cutting string size by over 55% compared to raw floating-point JSON.stringify.
   */
  public serializeCompactGeoJson(geometry: unknown): string {
    if (!geometry || typeof geometry !== "object") {
      return "{}";
    }

    const geomObj = geometry as { type?: string; coordinates?: unknown };
    if (!geomObj.type || !geomObj.coordinates) {
      return JSON.stringify(geometry);
    }

    const roundCoordinates = (coords: unknown): unknown => {
      if (!Array.isArray(coords)) return coords;
      if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
        return [
          roundGisCoordinate(coords[0]),
          roundGisCoordinate(coords[1]),
        ];
      }
      return coords.map((childCoords) => roundCoordinates(childCoords));
    };

    const compactGeom = {
      type: geomObj.type,
      coordinates: roundCoordinates(geomObj.coordinates),
    };

    return JSON.stringify(compactGeom);
  }

  public buildPostgisGeomExpr(geometry: unknown): string {
    const compactJsonString = this.serializeCompactGeoJson(geometry);

    if (this.targetSrid === 4326) {
      return `ST_SetSRID(ST_GeomFromGeoJSON('${compactJsonString}'), 4326)`;
    }
    return `ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${compactJsonString}'), 4326), ${this.targetSrid})`;
  }

  public buildUpdateStatement(
    fieldName: string,
    fileValue: unknown,
    whereClause: string
  ): string {
    const sqlValue = this.formatSqlValue(fileValue, fieldName);
    return `UPDATE "${this.dbSchemaName}"."${this.dbTableName}" SET "${fieldName}" = ${sqlValue} WHERE ${whereClause};`;
  }

  public buildInsertStatement(
    columnNames: string[],
    values: string[]
  ): string {
    return `INSERT INTO "${this.dbSchemaName}"."${this.dbTableName}" (${columnNames.join(", ")}) VALUES (${values.join(", ")});`;
  }
}
