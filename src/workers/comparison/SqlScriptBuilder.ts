/**
 * SqlScriptBuilder.ts
 * Object-Oriented Builder for high-speed, compact SQL generation (INSERT, UPDATE) and PostGIS expressions.
 */

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
   * Serializes a geometry to standard GeoJSON string preserving full float64 coordinate fidelity.
   */
  public serializeCompactGeoJson(geometry: unknown): string {
    if (!geometry || typeof geometry !== "object") {
      return "{}";
    }
    return JSON.stringify(geometry);
  }

  public buildPostgisGeomExpr(
    geometry: unknown,
    targetColumnName?: string,
    sourceSrid?: number
  ): string {
    const compactJsonString = this.serializeCompactGeoJson(geometry);
    const originSrid = sourceSrid || (this.targetSrid !== 4326 ? this.targetSrid : 4326);

    let baseExpr: string;
    if (originSrid === this.targetSrid) {
      baseExpr = `ST_SetSRID(ST_GeomFromGeoJSON('${compactJsonString}'), ${this.targetSrid})`;
    } else {
      baseExpr = `ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${compactJsonString}'), ${originSrid}), ${this.targetSrid})`;
    }

    const targetType =
      targetColumnName && this.dbColumnTypes
        ? this.dbColumnTypes[targetColumnName]?.toLowerCase()
        : undefined;

    const isMultiTarget = targetType ? targetType.includes("multi") : false;

    const geomObj = geometry as { type?: string };
    const isSingleType =
      geomObj &&
      (geomObj.type === "Polygon" || geomObj.type === "LineString" || geomObj.type === "Point");

    if (isMultiTarget && isSingleType) {
      return `ST_Multi(${baseExpr})`;
    }

    return baseExpr;
  }

  public buildUpdateStatement(
    fieldName: string,
    fileValue: unknown,
    whereClause: string
  ): string {
    const sqlValue = this.formatSqlValue(fileValue, fieldName);
    return `UPDATE "${this.dbSchemaName}"."${this.dbTableName}" SET "${fieldName}" = ${sqlValue} WHERE ${whereClause};`;
  }

  public buildUpdateStatementRaw(
    fieldName: string,
    rawSqlExpression: string,
    whereClause: string
  ): string {
    return `UPDATE "${this.dbSchemaName}"."${this.dbTableName}" SET "${fieldName}" = ${rawSqlExpression} WHERE ${whereClause};`;
  }

  public buildInsertStatement(
    columnNames: string[],
    values: string[]
  ): string {
    return `INSERT INTO "${this.dbSchemaName}"."${this.dbTableName}" (${columnNames.join(", ")}) VALUES (${values.join(", ")});`;
  }
}
