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
    const targetType =
      targetColumnName && this.dbColumnTypes
        ? this.dbColumnTypes[targetColumnName]?.toLowerCase()
        : undefined;

    let effectiveTargetSrid = this.targetSrid;
    if (targetType) {
      const typeSridMatch = targetType.match(/,\s*(\d+)\s*\)/);
      if (typeSridMatch && Number(typeSridMatch[1]) > 0) {
        effectiveTargetSrid = Number(typeSridMatch[1]);
      }
    }

    const originSrid = sourceSrid || (effectiveTargetSrid !== 4326 ? effectiveTargetSrid : 4326);

    let baseExpr: string;
    if (originSrid === effectiveTargetSrid) {
      baseExpr = `ST_SetSRID(ST_GeomFromGeoJSON('${compactJsonString}'), ${effectiveTargetSrid})`;
    } else {
      baseExpr = `ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${compactJsonString}'), ${originSrid}), ${effectiveTargetSrid})`;
    }

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

  public buildCompositeUpdateStatement(
    setClauses: Array<{ column: string; valueExpr: string }>,
    whereClause: string
  ): string {
    const assignments = setClauses
      .map((item) => `"${item.column}" = ${item.valueExpr}`)
      .join(", ");
    return `UPDATE "${this.dbSchemaName}"."${this.dbTableName}" SET ${assignments} WHERE ${whereClause};`;
  }

  public buildInsertStatement(
    columnNames: string[],
    values: string[]
  ): string {
    return `INSERT INTO "${this.dbSchemaName}"."${this.dbTableName}" (${columnNames.join(", ")}) VALUES (${values.join(", ")});`;
  }
}
