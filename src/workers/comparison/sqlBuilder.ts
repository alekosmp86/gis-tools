/**
 * sqlBuilder.ts
 * Utilidades para generación y escape de sentencias SQL (INSERT, UPDATE) y expresiones espaciales PostGIS.
 */

import { cleanValue } from "./suidKeyUtils";

export function isNumericColumnType(dataType?: string): boolean {
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

export function toSqlValue(
  value: unknown,
  columnName?: string,
  dbColumnTypes?: Record<string, string>
): string {
  if (value === null || value === undefined) return "NULL";
  const cleaned = cleanValue(value);
  if (cleaned === "") return "NULL";

  const dataType = columnName && dbColumnTypes ? dbColumnTypes[columnName] : undefined;

  if (dataType) {
    if (isNumericColumnType(dataType)) {
      const parsedNumber = Number(cleaned);
      if (!isNaN(parsedNumber)) return cleaned;
    }
    // Character varying, text, varchar, char, date, uuid, etc. MUST be single-quoted
    return `'${cleaned.replace(/'/g, "''")}'`;
  }

  // Fallback si el tipo de columna de base de datos no está especificado:
  if (typeof value === "number" && !isNaN(value)) {
    return cleaned;
  }

  return `'${cleaned.replace(/'/g, "''")}'`;
}

export function toSqlWhereCondition(
  columnName: string,
  value: unknown,
  dbColumnTypes?: Record<string, string>
): string {
  const sqlValue = toSqlValue(value, columnName, dbColumnTypes);
  if (sqlValue === "NULL") {
    return `"${columnName}" IS NULL`;
  }
  return `"${columnName}" = ${sqlValue}`;
}

export function findDbGeometryColumn(
  dbRecord?: Record<string, unknown>,
  dbColumnTypes?: Record<string, string>
): string | undefined {
  if (dbColumnTypes) {
    const directMatch = Object.keys(dbColumnTypes).find((key) =>
      ["geom", "geometry", "wkb_geometry", "geom_3857", "the_geom", "shape"].includes(
        key.toLowerCase()
      )
    );
    if (directMatch) return directMatch;

    const typeMatch = Object.keys(dbColumnTypes).find((key) => {
      const typeStr = dbColumnTypes[key]?.toLowerCase() || "";
      return (
        typeStr.includes("geometry") ||
        typeStr.includes("geography") ||
        typeStr === "user-defined"
      );
    });
    if (typeMatch) return typeMatch;
  }

  if (dbRecord) {
    const directMatch = Object.keys(dbRecord).find((key) =>
      ["geom", "geometry", "wkb_geometry", "geom_3857", "the_geom", "shape"].includes(
        key.toLowerCase()
      )
    );
    if (directMatch) return directMatch;
  }

  return undefined;
}

export function buildPostgisGeomExpr(
  geometry: unknown,
  targetSrid?: number
): string {
  const jsonGeometryString = JSON.stringify(geometry);
  const resolvedSrid = targetSrid && targetSrid > 0 ? targetSrid : 4326;

  if (resolvedSrid === 4326) {
    return `ST_SetSRID(ST_GeomFromGeoJSON('${jsonGeometryString}'), 4326)`;
  }
  return `ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${jsonGeometryString}'), 4326), ${resolvedSrid})`;
}

export function generateSqlScriptHeader(
  scriptType: string,
  dbSchemaName: string,
  dbTableName: string,
  fileName: string,
  suidColumns: string[]
): string[] {
  return [
    `-- ============================================================`,
    `-- ${scriptType}: ${dbSchemaName}.${dbTableName}`,
    `-- Fuente de comparación: ${fileName}`,
    `-- Clave SUID: ${suidColumns.join(", ")}`,
    `-- Generado automáticamente por GIS Tools`,
    `-- ============================================================`,
    "",
  ];
}
