import type { DbConfig } from "@/types/db";
import type { ParsedShapefileData } from "@/types/shp";
import type { ColumnMappingConfig } from "@/types/gis";
import { DiscrepancyType, type ComparisonSummary, type DiscrepancyItem, type AttributeDifference } from "@/types/comparison";

/**
 * Normalizes attribute string values according to GIS domain rules:
 * - Strips surrounding single or double quotes (e.g. '"TA014I111T9"' -> 'TA014I111T9').
 * - Strips non-breaking spaces (\xa0), tabs, and newlines.
 * - Strips floating point '.0' suffixes (e.g. '1002.0' -> '1002').
 */
export function cleanValue(val: unknown): string {
  if (val === null || val === undefined) return "";
  let str = String(val).trim();
  // Strip surrounding quotes if present
  str = str.replace(/^["']|["']$/g, "").trim();
  str = str.replace(/[\r\n\t\xa0]/g, "");
  if (str.endsWith(".0")) {
    str = str.slice(0, -2);
  }
  return str;
}

/**
 * Normalizes SUID key strings (lowercased for key lookups).
 */
export function cleanSuid(val: unknown): string {
  return cleanValue(val).toLowerCase();
}

/**
 * Executes full correlation analysis between DB records and in-memory Shapefile features.
 */
export async function runDatasetComparison(
  dbConfig: DbConfig,
  shapefileData: ParsedShapefileData,
  mappingConfig: ColumnMappingConfig
): Promise<ComparisonSummary> {
  // 1. Fetch DB Records from API route
  const res = await fetch("/api/db/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...dbConfig,
      suid_column: mappingConfig.suidColumn,
      fields_to_compare: mappingConfig.fieldsToCompare,
    }),
  });

  const dbData = await res.json();
  if (!res.ok || !dbData.success) {
    throw new Error(dbData.error || "No se pudieron consultar los registros de la base de datos.");
  }

  const dbRecords: Array<Record<string, unknown>> = dbData.records || [];
  const shpFeatures = shapefileData.geojson.features || [];

  // 2. Index DB Records by Cleaned SUID
  const dbMap = new Map<string, Record<string, unknown>>();
  dbRecords.forEach((rec) => {
    const rawSuid = rec[mappingConfig.suidColumn];
    const key = cleanSuid(rawSuid);
    if (key) {
      dbMap.set(key, rec);
    }
  });

  // 3. Index Shapefile Features by Cleaned SUID
  const shpMap = new Map<string, (typeof shpFeatures)[0]>();
  const shpKeyAttr = mappingConfig.matchedShpSuidColumn;

  shpFeatures.forEach((feat) => {
    if (feat.properties && shpKeyAttr) {
      const rawSuid = feat.properties[shpKeyAttr];
      const key = cleanSuid(rawSuid);
      if (key) {
        shpMap.set(key, feat);
      }
    }
  });

  const discrepancyItems: DiscrepancyItem[] = [];
  const sqlStatements: string[] = [
    `-- ============================================================`,
    `-- PARCHE SQL GENERADO PARA POSTGIS: ${dbConfig.schema_name}.${dbConfig.table_name}`,
    `-- Generado automáticamente por Antigravity GIS Tools`,
    `-- ============================================================\n`,
  ];

  let exactMatchesCount = 0;
  let attributeMismatchCount = 0;
  let onlyInDbCount = 0;
  let onlyInShpCount = 0;

  const processedSuids = new Set<string>();

  // 4. Compare DB Records against Shapefile Features
  dbMap.forEach((dbRec, suidKey) => {
    processedSuids.add(suidKey);
    const shpFeat = shpMap.get(suidKey);
    const rawSuid = String(dbRec[mappingConfig.suidColumn]);

    if (!shpFeat) {
      onlyInDbCount++;
      discrepancyItems.push({
        id: `db-${suidKey}`,
        suid: rawSuid,
        type: DiscrepancyType.ONLY_IN_DB,
        differences: [],
        dbRecord: dbRec,
      });
      return;
    }

    // Both present -> Compare requested attribute fields
    const differences: AttributeDifference[] = [];
    const shpProps = shpFeat.properties || {};

    mappingConfig.fieldsToCompare.forEach((field) => {
      const dbVal = dbRec[field] !== undefined ? dbRec[field] : null;

      // Find matching SHP key (exact or 10-char DBF)
      const fieldLower = field.toLowerCase();
      const field10Lower = fieldLower.slice(0, 10);
      const shpKeyMatch = Object.keys(shpProps).find(
        (k) => k.toLowerCase() === fieldLower || k.toLowerCase() === field10Lower
      );

      const shpVal = shpKeyMatch !== undefined ? shpProps[shpKeyMatch] : null;

      const normDb = cleanValue(dbVal);
      const normShp = cleanValue(shpVal);

      if (normDb !== normShp) {
        differences.push({
          fieldName: field,
          dbValue: dbVal as string | number | null,
          shpValue: shpVal as string | number | null,
        });

        // Generate clean SQL Update statement
        const cleanShpVal = cleanValue(shpVal);
        const sqlValue = typeof shpVal === "number" ? shpVal : `'${cleanShpVal.replace(/'/g, "''")}'`;
        sqlStatements.push(
          `UPDATE "${dbConfig.schema_name}"."${dbConfig.table_name}" SET "${field}" = ${sqlValue} WHERE "${mappingConfig.suidColumn}" = '${rawSuid}';`
        );
      }
    });

    if (differences.length > 0) {
      attributeMismatchCount++;
      discrepancyItems.push({
        id: `mismatch-${suidKey}`,
        suid: rawSuid,
        type: DiscrepancyType.ATTRIBUTE_MISMATCH,
        differences,
        dbRecord: dbRec,
        shpFeatureProps: shpProps,
        shpGeometry: shpFeat.geometry,
      });
    } else {
      exactMatchesCount++;
      discrepancyItems.push({
        id: `match-${suidKey}`,
        suid: rawSuid,
        type: DiscrepancyType.MATCH,
        differences: [],
        dbRecord: dbRec,
        shpFeatureProps: shpProps,
        shpGeometry: shpFeat.geometry,
      });
    }
  });

  // 5. Check features present only in Shapefile
  shpMap.forEach((shpFeat, suidKey) => {
    if (!processedSuids.has(suidKey)) {
      onlyInShpCount++;
      const shpProps = shpFeat.properties || {};
      const rawSuid = String(shpProps[mappingConfig.matchedShpSuidColumn] || suidKey);

      discrepancyItems.push({
        id: `shp-${suidKey}`,
        suid: rawSuid,
        type: DiscrepancyType.ONLY_IN_SHP,
        differences: [],
        shpFeatureProps: shpProps,
        shpGeometry: shpFeat.geometry,
      });
    }
  });

  return {
    totalAnalyzed: processedSuids.size + onlyInShpCount,
    exactMatchesCount,
    attributeMismatchCount,
    geometryMismatchCount: 0,
    onlyInDbCount,
    onlyInShpCount,
    items: discrepancyItems,
    sqlPatchScript: sqlStatements.join("\n"),
  };
}
