/**
 * comparisonWorker.ts
 * Web Worker — runs all CPU-intensive comparison logic off the main thread.
 * Supports multi-column Composite SUID keys and dual SQL patch generation.
 */
import type { WorkerInputMessage, WorkerOutputMessage } from "@/types/workerMessages";
import type { DiscrepancyItem, AttributeDifference, ComparisonSummary } from "@/types/comparison";
import { DiscrepancyType } from "@/types/comparison";

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

function emitProgress(phase: string, current: number, total: number): void {
  const msg: WorkerOutputMessage = { type: "PROGRESS", phase, current, total };
  self.postMessage(msg);
}

function toSqlValue(val: unknown): string {
  if (val === null || val === undefined || cleanValue(val) === "") return "NULL";
  const cleaned = cleanValue(val);
  if (typeof val === "number" || (!isNaN(Number(val)) && String(val).trim() !== "")) {
    return cleaned;
  }
  return `'${cleaned.replace(/'/g, "''")}'`;
}

function buildCompositeKey(rec: Record<string, unknown>, cols: string[]): string {
  const cleanedVals = cols.map((col) => cleanSuid(rec[col]));
  if (cleanedVals.some((val) => !val)) return "";
  return cleanedVals.join("_");
}

function buildCompositeRawSuid(rec: Record<string, unknown>, cols: string[]): string {
  const parts: string[] = [];
  for (const col of cols) {
    const val = cleanValue(rec[col]);
    if (val) parts.push(val);
  }
  return parts.join(" | ");
}

self.onmessage = (event: MessageEvent<WorkerInputMessage>) => {
  if (event.data.type !== "RUN_COMPARISON") return;
  try {
    const result = runComparison(event.data.payload);
    const doneMsg: WorkerOutputMessage = { type: "DONE", payload: result };
    self.postMessage(doneMsg);
  } catch (err) {
    const errorMsg: WorkerOutputMessage = {
      type: "ERROR",
      message: err instanceof Error ? err.message : "Error desconocido en el motor de comparación.",
    };
    self.postMessage(errorMsg);
  }
};

function runComparison(payload: WorkerInputMessage["payload"]): ComparisonSummary {
  const { dbRecords, fileDataset, mappingConfig, dbSchemaName, dbTableName } = payload;
  const { suidColumns, matchedFileSuidColumns, fieldsToCompare, insertDefaults } = mappingConfig;

  const dbSuidCols = suidColumns || [];
  const targetFileSuidCols = matchedFileSuidColumns || [];

  const totalDbRecords = dbRecords.length;
  const shpFeatures = (fileDataset.geojson as { features?: unknown[] } | undefined)?.features ?? [];
  const totalFileRecords =
    fileDataset.featureCount ||
    (shpFeatures.length > 0 ? shpFeatures.length : Object.keys(fileDataset.recordsObject).length);

  const discrepancyItems: DiscrepancyItem[] = [];

  const SQL_HEADER = (scriptType: string) => [
    `-- ============================================================`,
    `-- ${scriptType}: ${dbSchemaName}.${dbTableName}`,
    `-- Fuente de comparación: ${fileDataset.fileName}`,
    `-- Clave SUID: ${dbSuidCols.join(", ")}`,
    `-- Generado automáticamente por GIS Tools`,
    `-- ============================================================\n`,
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
    if (i % 500 === 0) emitProgress("Indexando registros de base de datos", i, totalDbRecords);
  });
  emitProgress("Indexando registros de base de datos", totalDbRecords, totalDbRecords);

  // Phase 2: Index Target File Records by Composite SUID Key
  const fileSuidMap = new Map<string, Array<Record<string, unknown>>>();
  const fileGeomMap = new Map<string, unknown>();
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
            fileGeomMap.set(key, feat.geometry);
          }
        }
        if (i % 500 === 0) emitProgress("Indexando archivo fuente", i, totalFileRecords);
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
      if (i % 500 === 0) emitProgress("Indexando archivo fuente", i, totalFileRecords);
    });
  }
  emitProgress("Indexando archivo fuente", totalFileRecords, totalFileRecords);

  // Phase 3: Pre-compute field -> file column key map
  const firstFileRecord: Record<string, unknown> =
    (fileSuidMap.values().next().value as Array<Record<string, unknown>> | undefined)?.[0] ??
    fileNullRecords[0] ??
    {};

  const fieldToFileKey = new Map<string, string | null>();
  fieldsToCompare.forEach((field) => {
    if (mappingConfig.attributeMap && mappingConfig.attributeMap[field]) {
      fieldToFileKey.set(field, mappingConfig.attributeMap[field]);
      return;
    }

    const fieldLower = field.toLowerCase();
    const field10 = fieldLower.slice(0, 10);
    const match = Object.keys(firstFileRecord).find(
      (k) => k.toLowerCase() === fieldLower || k.toLowerCase() === field10
    );
    fieldToFileKey.set(field, match ?? null);
  });

  // Phase 4: Report NULL SUIDs
  dbNullRecords.forEach((rec, idx) => {
    nullSuidCount++;
    discrepancyItems.push({
      id: `null-db-${idx}`,
      suid: "(SUID NULL / Vacío en DB)",
      type: DiscrepancyType.NULL_SUID,
      differences: [],
      dbRecord: rec,
      note: "Registro en base de datos sin clave identificadora SUID completa.",
    });
  });
  fileNullRecords.forEach((rec, idx) => {
    nullSuidCount++;
    discrepancyItems.push({
      id: `null-file-${idx}`,
      suid: "(SUID NULL / Vacío en Archivo)",
      type: DiscrepancyType.NULL_SUID,
      differences: [],
      shpFeatureProps: rec,
      note: "Registro en archivo fuente sin clave identificadora SUID completa.",
    });
  });

  // Phase 5: Main Comparison Loop (DB vs File)
  const processedSuids = new Set<string>();
  let loopIdx = 0;
  const dbMapSize = dbSuidMap.size;

  dbSuidMap.forEach((dbRecList, suidKey) => {
    processedSuids.add(suidKey);
    const fileRecList = fileSuidMap.get(suidKey) ?? [];
    const isDuplicate = dbRecList.length > 1 || fileRecList.length > 1;
    if (isDuplicate) duplicateSuidCount += Math.max(dbRecList.length, fileRecList.length);

    dbRecList.forEach((dbRec, dbIdx) => {
      const fileRec = fileRecList[dbIdx] ?? fileRecList[0];
      const rawSuid = buildCompositeRawSuid(dbRec, dbSuidCols) || suidKey;

      if (!fileRec) {
        onlyInDbCount++;
        discrepancyItems.push({
          id: `db-${suidKey}-${dbIdx}`,
          suid: rawSuid,
          type: isDuplicate ? DiscrepancyType.DUPLICATE_SUID : DiscrepancyType.ONLY_IN_DB,
          differences: [],
          dbRecord: dbRec,
          note: isDuplicate ? `SUID Duplicado (Ocurrencia #${dbIdx + 1} en DB)` : undefined,
        });
        return;
      }

      const differences: AttributeDifference[] = [];

      fieldsToCompare.forEach((field) => {
        const dbVal = dbRec[field] !== undefined ? dbRec[field] : null;
        const fileKey = fieldToFileKey.get(field);
        const fileVal = fileKey != null ? fileRec[fileKey] : null;

        if (cleanValue(dbVal) !== cleanValue(fileVal)) {
          differences.push({
            fieldName: field,
            dbValue: dbVal as string | number | null,
            shpValue: fileVal as string | number | null,
          });

          // Build multi-column WHERE clause for composite SUID
          const whereClause = dbSuidCols
            .map((col) => `"${col}" = ${toSqlValue(dbRec[col])}`)
            .join(" AND ");

          updateStatements.push(
            `UPDATE "${dbSchemaName}"."${dbTableName}" SET "${field}" = ${toSqlValue(fileVal)} WHERE ${whereClause};`
          );
        }
      });

      const resolvedType = isDuplicate
        ? DiscrepancyType.DUPLICATE_SUID
        : differences.length > 0
          ? DiscrepancyType.ATTRIBUTE_MISMATCH
          : DiscrepancyType.MATCH;

      if (differences.length > 0) attributeMismatchCount++;
      else exactMatchesCount++;

      discrepancyItems.push({
        id: `${differences.length > 0 ? "mismatch" : "match"}-${suidKey}-${dbIdx}`,
        suid: rawSuid,
        type: resolvedType,
        differences,
        dbRecord: dbRec,
        shpFeatureProps: fileRec,
        shpGeometry: fileGeomMap.get(suidKey),
        note: isDuplicate
          ? `SUID Duplicado (${dbRecList.length} en DB / ${fileRecList.length} en Archivo)`
          : undefined,
      });
    });

    loopIdx++;
    if (loopIdx % 200 === 0) emitProgress("Comparando atributos", loopIdx, dbMapSize);
  });
  emitProgress("Comparando atributos", dbMapSize, dbMapSize);

  // Phase 6: Only-in-file scan -> generates INSERT statements
  let fileLoopIdx = 0;
  const fileSuidMapSize = fileSuidMap.size;

  fileSuidMap.forEach((fileRecList, suidKey) => {
    if (!processedSuids.has(suidKey)) {
      onlyInShpCount += fileRecList.length;

      fileRecList.forEach((fileRec, fIdx) => {
        const rawSuid = buildCompositeRawSuid(fileRec, targetFileSuidCols) || suidKey;

        discrepancyItems.push({
          id: `file-${suidKey}-${fIdx}`,
          suid: rawSuid,
          type: DiscrepancyType.ONLY_IN_SHP,
          differences: [],
          shpFeatureProps: fileRec,
          shpGeometry: fileGeomMap.get(suidKey),
        });

        // Build INSERT statement: SUID columns + mapped fields + unmapped user defaults
        const insertCols: string[] = [];
        const insertVals: string[] = [];

        dbSuidCols.forEach((col, cIdx) => {
          const fCol = targetFileSuidCols[cIdx] || targetFileSuidCols[0];
          const val = fileRec[fCol] ?? fileRec[col];
          insertCols.push(`"${col}"`);
          insertVals.push(toSqlValue(val));
        });

        fieldsToCompare.forEach((field) => {
          const fileKey = fieldToFileKey.get(field);
          if (fileKey != null) {
            insertCols.push(`"${field}"`);
            insertVals.push(toSqlValue(fileRec[fileKey]));
          }
        });

        if (insertDefaults) {
          Object.entries(insertDefaults).forEach(([fieldName, defConfig]) => {
            if (defConfig.value && defConfig.value.trim() !== "") {
              insertCols.push(`"${fieldName}"`);
              if (defConfig.useRawExpression) {
                insertVals.push(defConfig.value.trim());
              } else {
                insertVals.push(toSqlValue(defConfig.value));
              }
            }
          });
        }

        insertStatements.push(
          `INSERT INTO "${dbSchemaName}"."${dbTableName}" (${insertCols.join(", ")}) VALUES (${insertVals.join(", ")});`
        );
      });
    }

    fileLoopIdx++;
    if (fileLoopIdx % 200 === 0) emitProgress("Generando sentencias INSERT", fileLoopIdx, fileSuidMapSize);
  });
  emitProgress("Generando sentencias INSERT", fileSuidMapSize, fileSuidMapSize);

  return {
    totalDbRecords,
    totalFileRecords,
    totalAnalyzed: discrepancyItems.length,
    exactMatchesCount,
    attributeMismatchCount,
    geometryMismatchCount: 0,
    onlyInDbCount,
    onlyInShpCount,
    nullSuidCount,
    duplicateSuidCount,
    items: discrepancyItems,
    sqlUpdateScript: updateStatements.join("\n"),
    sqlInsertScript: insertStatements.join("\n"),
  };
}
