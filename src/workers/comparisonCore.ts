/**
 * comparisonCore.ts
 * Core comparison engine — pure logic shared between Web Worker and Sync execution.
 * Supports multi-column Composite SUID keys and dual SQL patch generation.
 */
import type { WorkerInputMessage } from "@/types/workerMessages";
import type { DiscrepancyItem, AttributeDifference, ComparisonSummary } from "@/types/comparison";
import { DiscrepancyType } from "@/types/comparison";

export type ProgressEmitter = (phase: string, current: number, total: number) => void;

function cleanValue(val: unknown): string {
  if (val === null || val === undefined) return "";
  let str = String(val).trim();
  str = str.replace(/^["']|["']$/g, "").trim();
  str = str.replace(/[\r\n\t\xa0]/g, "");
  if (str.endsWith(".0")) str = str.slice(0, -2);
  return str;
}

function cleanSuid(val: unknown): string {
  return cleanValue(val).toLowerCase();
}

function isNumericColumnType(dataType?: string): boolean {
  if (!dataType) return false;
  const dt = dataType.toLowerCase();
  return (
    dt.includes("int") ||
    dt.includes("num") ||
    dt.includes("decimal") ||
    dt.includes("float") ||
    dt.includes("double") ||
    dt.includes("real") ||
    dt.includes("serial")
  );
}

function toSqlValue(
  val: unknown,
  colName?: string,
  dbColumnTypes?: Record<string, string>
): string {
  if (val === null || val === undefined) return "NULL";
  const cleaned = cleanValue(val);
  if (cleaned === "") return "NULL";

  const dataType = colName && dbColumnTypes ? dbColumnTypes[colName] : undefined;

  if (dataType) {
    if (isNumericColumnType(dataType)) {
      const num = Number(cleaned);
      if (!isNaN(num)) return cleaned;
    }
    // Character varying, text, varchar, char, date, uuid, etc. MUST be single-quoted
    return `'${cleaned.replace(/'/g, "''")}'`;
  }

  // Fallback if database column data type is unknown:
  // ONLY output unquoted SQL number if the original value was a JS primitive number
  if (typeof val === "number" && !isNaN(val)) {
    return cleaned;
  }

  // All string values (including numeric strings like "706112") MUST be single-quoted
  return `'${cleaned.replace(/'/g, "''")}'`;
}

function toSqlWhereCondition(
  col: string,
  val: unknown,
  dbColumnTypes?: Record<string, string>
): string {
  const sqlVal = toSqlValue(val, col, dbColumnTypes);
  if (sqlVal === "NULL") {
    return `"${col}" IS NULL`;
  }
  return `"${col}" = ${sqlVal}`;
}

function buildCompositeKey(rec: Record<string, unknown>, cols: string[]): string {
  const cleanedVals = cols.map((col) => cleanSuid(rec[col]));
  if (cols.length === 1) {
    if (!cleanedVals[0]) return "";
  } else {
    if (cleanedVals.every((val) => !val)) return "";
  }
  return cleanedVals.join("_");
}

function buildCompositeRawSuid(rec: Record<string, unknown>, cols: string[]): string {
  const parts: string[] = cols.map((col) => {
    const val = cleanValue(rec[col]);
    return val !== "" ? val : "NULL";
  });
  return parts.join(" | ");
}

export function runComparisonCore(
  payload: WorkerInputMessage["payload"],
  onProgress?: ProgressEmitter
): ComparisonSummary {
  const { dbRecords, fileDataset, mappingConfig, dbSchemaName, dbTableName, dbColumnTypes } = payload;
  const { suidColumns, matchedFileSuidColumns, fieldsToCompare, insertDefaults } = mappingConfig;

  const dbSuidCols = suidColumns || [];
  const targetFileSuidCols = matchedFileSuidColumns || [];

  const emit = (phase: string, current: number, total: number) => {
    onProgress?.(phase, current, total);
  };

  const totalDbRecords = dbRecords.length;
  const shpFeatures =
    (fileDataset.geojson as { features?: unknown[] } | undefined)?.features ?? [];
  const totalFileRecords =
    shpFeatures.length > 0 ? shpFeatures.length : Object.keys(fileDataset.recordsObject).length;

  const discrepancyItems: DiscrepancyItem[] = [];

  const SQL_HEADER = (scriptType: string) => [
    `-- ============================================================`,
    `-- ${scriptType}: ${dbSchemaName}.${dbTableName}`,
    `-- Fuente de comparación: ${fileDataset.fileName}`,
    `-- Clave SUID: ${dbSuidCols.join(", ")}`,
    `-- Generado automáticamente por GIS Tools`,
    `-- ============================================================`,
    "",
  ];

  const updateStatements: string[] = SQL_HEADER("SCRIPT DE ACTUALIZACIÓN (UPDATE) PARA POSTGIS");
  const insertStatements: string[] = SQL_HEADER("SCRIPT DE INSERCIÓN (INSERT) PARA POSTGIS");

  let exactMatchesCount = 0;
  let attributeMismatchCount = 0;
  let onlyInDbCount = 0;
  let onlyInShpCount = 0;
  let nullSuidCount = 0;
  let duplicateSuidCount = 0;

  // Phase 1: Index DB Records by Composite SUID Key
  const dbSuidMap = new Map<string, Array<Record<string, unknown>>>();
  const dbNullRecords: Array<Record<string, unknown>> = [];

  dbRecords.forEach((rec, i) => {
    const key = buildCompositeKey(rec, dbSuidCols);
    if (!key) {
      dbNullRecords.push(rec);
    } else {
      const arr = dbSuidMap.get(key) ?? [];
      arr.push(rec);
      dbSuidMap.set(key, arr);
    }
    if (i % 500 === 0) emit("Indexando registros de base de datos", i, totalDbRecords);
  });
  emit("Indexando registros de base de datos", totalDbRecords, totalDbRecords);

  // Phase 2: Index Target File Records & Geometries by Composite SUID Key
  const fileSuidMap = new Map<string, Array<Record<string, unknown>>>();
  const fileGeomMap = new Map<string, unknown[]>();
  const fileNullRecords: Array<Record<string, unknown>> = [];

  if (shpFeatures.length > 0) {
    (shpFeatures as Array<{ properties: Record<string, unknown>; geometry: unknown }>).forEach(
      (feat, i) => {
        if (feat.properties) {
          const key = buildCompositeKey(feat.properties, targetFileSuidCols);
          if (!key) {
            fileNullRecords.push(feat.properties);
          } else {
            const arr = fileSuidMap.get(key) ?? [];
            arr.push(feat.properties);
            fileSuidMap.set(key, arr);

            const geoms = fileGeomMap.get(key) ?? [];
            geoms.push(feat.geometry);
            fileGeomMap.set(key, geoms);
          }
        }
        if (i % 500 === 0) emit("Indexando archivo fuente", i, totalFileRecords);
      }
    );
  } else {
    Object.values(fileDataset.recordsObject).forEach((rec, i) => {
      const key = buildCompositeKey(rec, targetFileSuidCols);
      if (!key) {
        fileNullRecords.push(rec);
      } else {
        const arr = fileSuidMap.get(key) ?? [];
        arr.push(rec);
        fileSuidMap.set(key, arr);
      }
      if (i % 500 === 0) emit("Indexando archivo fuente", i, totalFileRecords);
    });
  }
  emit("Indexando archivo fuente", totalFileRecords, totalFileRecords);

  // Phase 3: Pre-compute field -> file column key map
  const firstFileRecord: Record<string, unknown> =
    (fileSuidMap.values().next().value as Array<Record<string, unknown>> | undefined)?.[0] ??
    fileNullRecords[0] ??
    {};

  const availableFileKeys: string[] =
    fileDataset.attributes && fileDataset.attributes.length > 0
      ? fileDataset.attributes
      : Object.keys(firstFileRecord);

  const fieldToFileKey = new Map<string, string | null>();
  fieldsToCompare.forEach((field) => {
    if (mappingConfig.attributeMap && mappingConfig.attributeMap[field]) {
      fieldToFileKey.set(field, mappingConfig.attributeMap[field]);
      return;
    }

    const fieldLower = field.toLowerCase();
    const field10 = fieldLower.slice(0, 10);
    const match = availableFileKeys.find(
      (k) => k.toLowerCase() === fieldLower || k.toLowerCase() === field10
    );
    fieldToFileKey.set(field, match ?? null);
  });

  // Phase 4: Report NULL SUIDs
  dbNullRecords.forEach((rec, idx) => {
    nullSuidCount++;
    const { differences, note } = extractNullRecordInfo(rec, true, fieldsToCompare, fieldToFileKey);
    discrepancyItems.push({
      id: `null-db-${idx}`,
      suid: "(SUID NULL / Vacío en DB)",
      type: DiscrepancyType.NULL_SUID,
      differences,
      dbRecord: rec,
      note,
    });
  });
  fileNullRecords.forEach((rec, idx) => {
    nullSuidCount++;
    const { differences, note } = extractNullRecordInfo(rec, false, fieldsToCompare, fieldToFileKey);
    discrepancyItems.push({
      id: `null-file-${idx}`,
      suid: "(SUID NULL / Vacío en Archivo)",
      type: DiscrepancyType.NULL_SUID,
      differences,
      shpFeatureProps: rec,
      note,
    });
  });

  // Phase 5: Main Comparison Loop (DB vs File)
  const processedSuids = new Set<string>();
  let processedDbRecordCount = 0;

  dbSuidMap.forEach((dbRecList, suidKey) => {
    processedSuids.add(suidKey);
    const fileRecList = fileSuidMap.get(suidKey) ?? [];
    const fileGeomList = fileGeomMap.get(suidKey) ?? [];
    const isDuplicate = dbRecList.length > 1 || fileRecList.length > 1;

    dbRecList.forEach((dbRec, dbIdx) => {
      processedDbRecordCount++;
      const fileRec = fileRecList[dbIdx] ?? fileRecList[0];
      const shpGeom = fileGeomList[dbIdx] ?? fileGeomList[0];
      const rawSuid = buildCompositeRawSuid(dbRec, dbSuidCols) || suidKey;

      if (!fileRec) {
        const differences: AttributeDifference[] = [];
        fieldsToCompare.forEach((field) => {
          const dbVal = dbRec[field] !== undefined ? dbRec[field] : null;
          if (cleanValue(dbVal) !== "") {
            differences.push({
              fieldName: field,
              dbValue: dbVal as string | number | null,
              shpValue: null,
            });
          }
        });

        const resolvedType = isDuplicate ? DiscrepancyType.DUPLICATE_SUID : DiscrepancyType.ONLY_IN_DB;
        if (resolvedType === DiscrepancyType.DUPLICATE_SUID) {
          duplicateSuidCount++;
        } else {
          onlyInDbCount++;
        }

        discrepancyItems.push({
          id: `db-${suidKey}-${dbIdx}`,
          suid: rawSuid,
          type: resolvedType,
          differences,
          dbRecord: dbRec,
          note: isDuplicate ? `SUID Duplicado (Ocurrencia #${dbIdx + 1} en DB)` : undefined,
        });
        if (processedDbRecordCount % 500 === 0) emit("Comparando atributos", processedDbRecordCount, totalDbRecords);
        return;
      }

      const differences: AttributeDifference[] = [];

      // Compute SQL WHERE clause once per record using column types for precise SQL literal quoting
      const whereClause = !isDuplicate
        ? dbSuidCols.map((col) => toSqlWhereCondition(col, dbRec[col], dbColumnTypes)).join(" AND ")
        : null;

      fieldsToCompare.forEach((field) => {
        const dbVal = dbRec[field] !== undefined ? dbRec[field] : null;
        const fileKey = fieldToFileKey.get(field);
        const fileVal = fileKey != null ? fileRec[fileKey] : null;

        const dbCleaned = cleanValue(dbVal);
        const fileCleaned = cleanValue(fileVal);

        if (dbCleaned !== fileCleaned) {
          differences.push({
            fieldName: field,
            dbValue: dbVal as string | number | null,
            shpValue: fileVal as string | number | null,
          });

          if (whereClause) {
            updateStatements.push(
              `UPDATE "${dbSchemaName}"."${dbTableName}" SET "${field}" = ${toSqlValue(fileVal, field, dbColumnTypes)} WHERE ${whereClause};`
            );
          }
        }
      });

      const resolvedType = isDuplicate
        ? DiscrepancyType.DUPLICATE_SUID
        : differences.length > 0
          ? DiscrepancyType.ATTRIBUTE_MISMATCH
          : DiscrepancyType.MATCH;

      if (resolvedType === DiscrepancyType.DUPLICATE_SUID) {
        duplicateSuidCount++;
      } else if (resolvedType === DiscrepancyType.ATTRIBUTE_MISMATCH) {
        attributeMismatchCount++;
      } else {
        exactMatchesCount++;
      }

      discrepancyItems.push({
        id: `${differences.length > 0 ? "mismatch" : "match"}-${suidKey}-${dbIdx}`,
        suid: rawSuid,
        type: resolvedType,
        differences,
        dbRecord: dbRec,
        shpFeatureProps: fileRec,
        shpGeometry: shpGeom,
        note: isDuplicate
          ? `SUID Duplicado (${dbRecList.length} en DB / ${fileRecList.length} en Archivo)`
          : undefined,
      });

      if (processedDbRecordCount % 500 === 0) emit("Comparando atributos", processedDbRecordCount, totalDbRecords);
    });
  });
  emit("Comparando atributos", totalDbRecords, totalDbRecords);

  // Phase 6: Only-in-file scan -> generates INSERT statements
  let totalUnmatchedFileRecords = 0;
  fileSuidMap.forEach((fileRecList, suidKey) => {
    if (!processedSuids.has(suidKey)) {
      totalUnmatchedFileRecords += fileRecList.length;
    }
  });

  let processedInsertRecordCount = 0;

  fileSuidMap.forEach((fileRecList, suidKey) => {
    if (!processedSuids.has(suidKey)) {
      const fileGeomList = fileGeomMap.get(suidKey) ?? [];
      onlyInShpCount += fileRecList.length;

      fileRecList.forEach((fileRec, fIdx) => {
        processedInsertRecordCount++;
        const rawSuid = buildCompositeRawSuid(fileRec, targetFileSuidCols) || suidKey;

        const differences: AttributeDifference[] = [];
        fieldsToCompare.forEach((field) => {
          const fileKey = fieldToFileKey.get(field);
          const fileVal = fileKey != null ? fileRec[fileKey] : null;
          if (cleanValue(fileVal) !== "") {
            differences.push({
              fieldName: field,
              dbValue: null,
              shpValue: fileVal as string | number | null,
            });
          }
        });

        discrepancyItems.push({
          id: `file-${suidKey}-${fIdx}`,
          suid: rawSuid,
          type: DiscrepancyType.ONLY_IN_SHP,
          differences,
          shpFeatureProps: fileRec,
          shpGeometry: fileGeomList[fIdx] ?? fileGeomList[0],
        });

        // Build INSERT statement: SUID columns + mapped fields + unmapped user defaults
        const insertCols: string[] = [];
        const insertVals: string[] = [];
        const addedCols = new Set<string>();

        dbSuidCols.forEach((col, cIdx) => {
          const fCol =
            targetFileSuidCols.length > 0
              ? targetFileSuidCols[cIdx] || targetFileSuidCols[0]
              : undefined;
          const val = fCol ? fileRec[fCol] ?? fileRec[col] : fileRec[col];
          insertCols.push(`"${col}"`);
          insertVals.push(toSqlValue(val, col, dbColumnTypes));
          addedCols.add(col);
        });

        fieldsToCompare.forEach((field) => {
          if (addedCols.has(field)) return;
          const fileKey = fieldToFileKey.get(field);
          if (fileKey != null) {
            insertCols.push(`"${field}"`);
            insertVals.push(toSqlValue(fileRec[fileKey], field, dbColumnTypes));
            addedCols.add(field);
          }
        });

        if (insertDefaults) {
          Object.entries(insertDefaults).forEach(([fieldName, defConfig]) => {
            if (addedCols.has(fieldName)) return;
            if (defConfig.value && defConfig.value.trim() !== "") {
              insertCols.push(`"${fieldName}"`);
              if (defConfig.useRawExpression) {
                insertVals.push(defConfig.value.trim());
              } else {
                insertVals.push(toSqlValue(defConfig.value, fieldName, dbColumnTypes));
              }
              addedCols.add(fieldName);
            }
          });
        }

        insertStatements.push(
          `INSERT INTO "${dbSchemaName}"."${dbTableName}" (${insertCols.join(", ")}) VALUES (${insertVals.join(", ")});`
        );

        if (processedInsertRecordCount % 500 === 0) {
          emit("Generando sentencias INSERT", processedInsertRecordCount, totalUnmatchedFileRecords);
        }
      });
    }
  });
  emit("Generando sentencias INSERT", totalUnmatchedFileRecords, totalUnmatchedFileRecords);

  return {
    totalDbRecords,
    totalFileRecords,
    totalAnalyzed: discrepancyItems.length,
    exactMatchesCount,
    attributeMismatchCount,
    geometryMismatchCount: 0, // @planned — see DiscrepancyType.GEOMETRY_MISMATCH
    onlyInDbCount,
    onlyInShpCount,
    nullSuidCount,
    duplicateSuidCount,
    items: discrepancyItems,
    sqlUpdateScript: updateStatements.join("\n"),
    sqlInsertScript: insertStatements.join("\n"),
  };
}

function extractNullRecordInfo(
  rec: Record<string, unknown>,
  isDb: boolean,
  fieldsToCompare: string[],
  fieldToFileKey?: Map<string, string | null>
): { differences: AttributeDifference[]; note: string } {
  const differences: AttributeDifference[] = [];
  const addedFields = new Set<string>();
  const summaryParts: string[] = [];

  // 1. Include fieldsToCompare if present in rec
  fieldsToCompare.forEach((field) => {
    let fileKey: string | null | undefined = field;
    if (!isDb && fieldToFileKey) {
      fileKey = fieldToFileKey.get(field);
    }
    const val = isDb ? rec[field] : fileKey ? rec[fileKey] : rec[field];
    if (val !== undefined && val !== null && cleanValue(val) !== "") {
      differences.push({
        fieldName: field,
        dbValue: isDb ? (val as string | number | null) : null,
        shpValue: isDb ? null : (val as string | number | null),
      });
      addedFields.add(field.toLowerCase());
      if (summaryParts.length < 3) {
        summaryParts.push(`${field}: ${String(val)}`);
      }
    }
  });

  // 2. Also check key/identifier/descriptor attributes in rec with precise matching
  Object.entries(rec).forEach(([key, val]) => {
    const keyLower = key.toLowerCase();
    if (addedFields.has(keyLower)) return;
    if (["geom", "geometry", "wkb_geometry", "shape_leng", "shape_area"].includes(keyLower)) return;

    const isIdentifierKey =
      /\bid\b/.test(keyLower) ||
      keyLower.endsWith("_id") ||
      keyLower.endsWith("_cod") ||
      keyLower.startsWith("cod") ||
      keyLower.startsWith("nom") ||
      keyLower.includes("name") ||
      keyLower.includes("ref") ||
      keyLower.startsWith("num");

    if (isIdentifierKey && val !== undefined && val !== null && cleanValue(val) !== "") {
      differences.push({
        fieldName: key,
        dbValue: isDb ? (val as string | number | null) : null,
        shpValue: isDb ? null : (val as string | number | null),
      });
      addedFields.add(keyLower);
      if (summaryParts.length < 3) {
        summaryParts.push(`${key}: ${String(val)}`);
      }
    }
  });

  // 3. Fallback: if no attributes added yet, add any non-null non-geometry attributes (up to 5)
  if (differences.length === 0) {
    Object.entries(rec).forEach(([key, val]) => {
      if (addedFields.size >= 5) return;
      const keyLower = key.toLowerCase();
      if (["geom", "geometry", "wkb_geometry", "shape_leng", "shape_area"].includes(keyLower)) return;
      if (val !== undefined && val !== null && cleanValue(val) !== "") {
        differences.push({
          fieldName: key,
          dbValue: isDb ? (val as string | number | null) : null,
          shpValue: isDb ? null : (val as string | number | null),
        });
        addedFields.add(keyLower);
        if (summaryParts.length < 3) {
          summaryParts.push(`${key}: ${String(val)}`);
        }
      }
    });
  }

  const originText = isDb ? "base de datos" : "archivo fuente";
  let note = `Registro en ${originText} sin clave identificadora SUID completa.`;
  if (summaryParts.length > 0) {
    note += ` [Atributos: ${summaryParts.join(" | ")}]`;
  }

  return { differences, note };
}
