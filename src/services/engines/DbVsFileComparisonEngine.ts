import type { DbConfig } from "@/types/db";
import type { ColumnMappingConfig } from "@/types/gis";
import type { ParsedFileDataset } from "@/types/parsers";
import {
  DiscrepancyType,
  type IComparisonEngine,
  type ComparisonSummary,
  type DiscrepancyItem,
  type AttributeDifference,
} from "@/types/comparison";
import { cleanSuid, cleanValue } from "@/utils/gisCleaners";

export class DbVsFileComparisonEngine implements IComparisonEngine {
  readonly engineName = "PostgreSQL vs Tabular File Comparison Engine";

  async compare(
    dbConfig: DbConfig,
    dataset: ParsedFileDataset,
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
    const shpFeatures = dataset.geojson?.features || [];

    // 2. Index DB Records by Cleaned SUID
    const dbMap = new Map<string, Record<string, unknown>>();
    dbRecords.forEach((rec) => {
      const rawSuid = rec[mappingConfig.suidColumn];
      const key = cleanSuid(rawSuid);
      if (key) {
        dbMap.set(key, rec);
      }
    });

    // 3. Index Target File Features/Records by Cleaned SUID
    const fileMap = new Map<string, Record<string, unknown>>();
    const shpGeomMap = new Map<string, unknown>();
    const fileKeyAttr = mappingConfig.matchedShpSuidColumn;

    if (dataset.geojson && shpFeatures.length > 0) {
      // Shapefile or GeoJSON
      shpFeatures.forEach((feat) => {
        if (feat.properties && fileKeyAttr) {
          const rawSuid = feat.properties[fileKeyAttr];
          const key = cleanSuid(rawSuid);
          if (key) {
            fileMap.set(key, feat.properties as Record<string, unknown>);
            shpGeomMap.set(key, feat.geometry);
          }
        }
      });
    } else {
      // CSV or Plain Tabular Dataset
      dataset.recordsMap.forEach((rec) => {
        if (fileKeyAttr) {
          const rawSuid = rec[fileKeyAttr];
          const key = cleanSuid(rawSuid);
          if (key) {
            fileMap.set(key, rec);
          }
        }
      });
    }

    const discrepancyItems: DiscrepancyItem[] = [];
    const sqlStatements: string[] = [
      `-- ============================================================`,
      `-- PARCHE SQL GENERADO PARA POSTGIS: ${dbConfig.schema_name}.${dbConfig.table_name}`,
      `-- Fuente de comparación: ${dataset.fileName}`,
      `-- Generado automáticamente por GIS Tools`,
      `-- ============================================================\n`,
    ];

    let exactMatchesCount = 0;
    let attributeMismatchCount = 0;
    let onlyInDbCount = 0;
    let onlyInShpCount = 0;

    const processedSuids = new Set<string>();

    // 4. Compare DB Records against File Dataset
    dbMap.forEach((dbRec, suidKey) => {
      processedSuids.add(suidKey);
      const fileRec = fileMap.get(suidKey);
      const rawSuid = String(dbRec[mappingConfig.suidColumn]);

      if (!fileRec) {
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

      mappingConfig.fieldsToCompare.forEach((field) => {
        const dbVal = dbRec[field] !== undefined ? dbRec[field] : null;

        // Find matching target key (exact or 10-char DBF)
        const fieldLower = field.toLowerCase();
        const field10Lower = fieldLower.slice(0, 10);
        const fileKeyMatch = Object.keys(fileRec).find(
          (k) => k.toLowerCase() === fieldLower || k.toLowerCase() === field10Lower
        );

        const fileVal = fileKeyMatch !== undefined ? fileRec[fileKeyMatch] : null;

        const normDb = cleanValue(dbVal);
        const normFile = cleanValue(fileVal);

        if (normDb !== normFile) {
          differences.push({
            fieldName: field,
            dbValue: dbVal as string | number | null,
            shpValue: fileVal as string | number | null,
          });

          // Generate clean SQL Update statement
          const cleanFileVal = cleanValue(fileVal);
          const sqlValue = typeof fileVal === "number" ? fileVal : `'${cleanFileVal.replace(/'/g, "''")}'`;
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
          shpFeatureProps: fileRec,
          shpGeometry: shpGeomMap.get(suidKey),
        });
      } else {
        exactMatchesCount++;
        discrepancyItems.push({
          id: `match-${suidKey}`,
          suid: rawSuid,
          type: DiscrepancyType.MATCH,
          differences: [],
          dbRecord: dbRec,
          shpFeatureProps: fileRec,
          shpGeometry: shpGeomMap.get(suidKey),
        });
      }
    });

    // 5. Check records present only in Target File
    fileMap.forEach((fileRec, suidKey) => {
      if (!processedSuids.has(suidKey)) {
        onlyInShpCount++;
        const rawSuid = String(fileRec[mappingConfig.matchedShpSuidColumn] || suidKey);

        discrepancyItems.push({
          id: `shp-${suidKey}`,
          suid: rawSuid,
          type: DiscrepancyType.ONLY_IN_SHP,
          differences: [],
          shpFeatureProps: fileRec,
          shpGeometry: shpGeomMap.get(suidKey),
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
}
