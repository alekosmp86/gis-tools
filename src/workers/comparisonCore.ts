/**
 * comparisonCore.ts
 * Motor principal de comparación espacial y matricial.
 * Optimizado para datasets masivos (1.000.000+ registros) en memoria RAM:
 * 1. Lectura binaria nativa de buffers SHP/DBF con indexación directa de punteros.
 * 2. Conteo atómico de coincidencias exactas (sin clonar 1M objetos en memoria).
 * 3. Generación automática de scripts SQL PostGIS (UPDATE e INSERT con geometrías ST_SetSRID/ST_Transform).
 */

import type { WorkerInputMessage } from "@/types/workerMessages";
import type {
  DiscrepancyItem,
  AttributeDifference,
  GeometryDifference,
  ComparisonSummary,
} from "@/types/comparison";
import { DiscrepancyType } from "@/types/comparison";
import { compareGeometries } from "@/utils/geometryComparator";
import { BinaryDbfReader, type DbfFieldDescriptor } from "@/utils/binaryDbfReader";
import { BinaryShpReader } from "@/utils/binaryShpReader";
import type { Geometry } from "geojson";

import {
  cleanValue,
  buildCompositeKeyFromRecord,
  buildCompositeRawSuidFromRecord,
} from "./comparison/suidKeyUtils";
import {
  toSqlValue,
  toSqlWhereCondition,
  findDbGeometryColumn,
  buildPostgisGeomExpr,
  generateSqlScriptHeader,
} from "./comparison/sqlBuilder";
import { createNullDiscrepancyItem } from "./comparison/nullRecordHandler";
import {
  indexBinaryDbfDataset,
  indexObjectDataset,
} from "./comparison/fileDatasetIndexer";

export type ProgressEmitter = (phase: string, current: number, total: number) => void;

function extractDbGeometry(dbRecord: Record<string, unknown>): unknown {
  const geomKey = Object.keys(dbRecord).find((key) =>
    ["geom", "geometry", "wkb_geometry", "shape", "st_asgeojson", "geojson"].includes(
      key.toLowerCase()
    )
  );
  return geomKey ? dbRecord[geomKey] : null;
}

export function runComparisonCore(
  payload: WorkerInputMessage["payload"],
  onProgress?: ProgressEmitter
): ComparisonSummary {
  const {
    dbRecords,
    fileDataset,
    mappingConfig,
    dbSchemaName,
    dbTableName,
    dbColumnTypes,
  } = payload;
  const { suidColumns, matchedFileSuidColumns, fieldsToCompare, insertDefaults } = mappingConfig;

  const dbSuidCols = suidColumns || [];
  const targetFileSuidCols = matchedFileSuidColumns || [];

  const emit = (phase: string, current: number, total: number) => {
    onProgress?.(phase, current, total);
  };

  const totalDbRecords = dbRecords.length;
  const discrepancyItems: DiscrepancyItem[] = [];

  const updateStatements: string[] = generateSqlScriptHeader(
    "SCRIPT DE ACTUALIZACIÓN (UPDATE) PARA POSTGIS",
    dbSchemaName,
    dbTableName,
    fileDataset.fileName,
    dbSuidCols
  );
  const insertStatements: string[] = generateSqlScriptHeader(
    "SCRIPT DE INSERCIÓN (INSERT) PARA POSTGIS",
    dbSchemaName,
    dbTableName,
    fileDataset.fileName,
    dbSuidCols
  );

  let exactMatchesCount = 0;
  let attributeMismatchCount = 0;
  let geometryMismatchCount = 0;
  let onlyInDbCount = 0;
  let onlyInShpCount = 0;
  let nullSuidCount = 0;
  let duplicateSuidCount = 0;

  // ==========================================
  // FASE 1: Indexación de Registros de Base de Datos
  // ==========================================
  const dbSuidMap = new Map<string, Array<Record<string, unknown>>>();
  const dbNullRecords: Array<Record<string, unknown>> = [];

  dbRecords.forEach((record, recordIndex) => {
    const key = buildCompositeKeyFromRecord(record, dbSuidCols);
    if (!key) {
      dbNullRecords.push(record);
    } else {
      const recordList = dbSuidMap.get(key) ?? [];
      recordList.push(record);
      dbSuidMap.set(key, recordList);
    }
    if (recordIndex % 10_000 === 0) {
      emit("Indexando registros de base de datos", recordIndex, totalDbRecords);
    }
  });
  emit("Indexando registros de base de datos", totalDbRecords, totalDbRecords);

  // ==========================================
  // FASE 2: Inicialización de Lectores e Indexación de Archivo
  // ==========================================
  let dbfReader: BinaryDbfReader | null = null;
  let shpReader: BinaryShpReader | null = null;

  if (fileDataset.dbfBuffer && fileDataset.dbfBuffer.byteLength > 0) {
    dbfReader = new BinaryDbfReader(
      fileDataset.dbfBuffer,
      fileDataset.cpgText || "windows-1252"
    );
    if (fileDataset.shpBuffer && fileDataset.shpBuffer.byteLength > 0) {
      try {
        shpReader = new BinaryShpReader(fileDataset.shpBuffer);
      } catch {
        shpReader = null;
      }
    }
  }

  let totalFileRecords = 0;
  let binaryFileSuidMap = new Map<string, number[]>();
  let binaryFileNullIndices: number[] = [];
  let objectFileSuidMap = new Map<string, Array<Record<string, unknown>>>();
  let objectFileGeomMap = new Map<string, unknown[]>();
  let objectFileNullRecords: Array<Record<string, unknown>> = [];
  const dbfCompareFields: Map<string, DbfFieldDescriptor | null> = new Map();
  const fieldToFileKey = new Map<string, string | null>();

  if (dbfReader) {
    const binaryIndex = indexBinaryDbfDataset(dbfReader, targetFileSuidCols, emit);
    binaryFileSuidMap = binaryIndex.binaryFileSuidMap;
    binaryFileNullIndices = binaryIndex.binaryFileNullIndices;
    totalFileRecords = binaryIndex.totalFileRecords;

    const availableDbfFields = dbfReader.header.fields;
    fieldsToCompare.forEach((field) => {
      let targetName = field;
      if (mappingConfig.attributeMap && mappingConfig.attributeMap[field]) {
        targetName = mappingConfig.attributeMap[field];
      }
      const match = availableDbfFields.find(
        (dbfField) =>
          dbfField.name.toLowerCase() === targetName.toLowerCase() ||
          dbfField.name.toLowerCase() === targetName.toLowerCase().slice(0, 10)
      );
      dbfCompareFields.set(field, match ?? null);
    });
  } else {
    const objectIndex = indexObjectDataset(fileDataset, targetFileSuidCols, emit);
    objectFileSuidMap = objectIndex.objectFileSuidMap;
    objectFileGeomMap = objectIndex.objectFileGeomMap;
    objectFileNullRecords = objectIndex.objectFileNullRecords;
    totalFileRecords = objectIndex.totalFileRecords;

    const availableKeys = fileDataset.attributes || [];
    fieldsToCompare.forEach((field) => {
      if (mappingConfig.attributeMap && mappingConfig.attributeMap[field]) {
        fieldToFileKey.set(field, mappingConfig.attributeMap[field]);
        return;
      }
      const fieldLower = field.toLowerCase();
      const field10 = fieldLower.slice(0, 10);
      const match = availableKeys.find(
        (attrKey) => attrKey.toLowerCase() === fieldLower || attrKey.toLowerCase() === field10
      );
      fieldToFileKey.set(field, match ?? null);
    });
  }

  // ==========================================
  // FASE 3: Registro de SUIDs Nulos / Vacíos
  // ==========================================
  dbNullRecords.forEach((record, recordIndex) => {
    nullSuidCount++;
    discrepancyItems.push(
      createNullDiscrepancyItem(
        `null-db-${recordIndex}`,
        record,
        true,
        fieldsToCompare,
        fieldToFileKey
      )
    );
  });

  if (dbfReader) {
    binaryFileNullIndices.forEach((recordIndex, indexOrder) => {
      nullSuidCount++;
      const record = dbfReader!.readRecord(recordIndex) || {};
      discrepancyItems.push(
        createNullDiscrepancyItem(
          `null-file-${indexOrder}`,
          record,
          false,
          fieldsToCompare,
          fieldToFileKey
        )
      );
    });
  } else {
    objectFileNullRecords.forEach((record, recordIndex) => {
      nullSuidCount++;
      discrepancyItems.push(
        createNullDiscrepancyItem(
          `null-file-${recordIndex}`,
          record,
          false,
          fieldsToCompare,
          fieldToFileKey
        )
      );
    });
  }

  // ==========================================
  // FASE 4: Bucle Principal de Comparación (DB vs Archivo)
  // ==========================================
  const processedSuids = new Set<string>();
  let processedDbRecordCount = 0;

  dbSuidMap.forEach((dbRecList, suidKey) => {
    processedSuids.add(suidKey);

    const binaryFileIndices = dbfReader ? binaryFileSuidMap.get(suidKey) ?? [] : [];
    const objectFileRecList = !dbfReader ? objectFileSuidMap.get(suidKey) ?? [] : [];
    const objectFileGeoms = !dbfReader ? objectFileGeomMap.get(suidKey) ?? [] : [];

    const fileMatchesCount = dbfReader ? binaryFileIndices.length : objectFileRecList.length;
    const isDuplicate = dbRecList.length > 1 || fileMatchesCount > 1;

    dbRecList.forEach((dbRec, dbIndex) => {
      processedDbRecordCount++;
      const rawSuid = buildCompositeRawSuidFromRecord(dbRec, dbSuidCols) || suidKey;

      if (fileMatchesCount === 0) {
        // Registro presente únicamente en Base de Datos
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

        const resolvedType = isDuplicate
          ? DiscrepancyType.DUPLICATE_SUID
          : DiscrepancyType.ONLY_IN_DB;

        if (resolvedType === DiscrepancyType.DUPLICATE_SUID) {
          duplicateSuidCount++;
        } else {
          onlyInDbCount++;
        }

        discrepancyItems.push({
          id: `db-${suidKey}-${dbIndex}`,
          suid: rawSuid,
          type: resolvedType,
          differences,
          dbRecord: dbRec,
          note: isDuplicate
            ? `SUID Duplicado (${dbRecList.length} en DB / 0 en Archivo)`
            : undefined,
        });
        return;
      }

      // Registro presente en ambos orígenes: Comparar atributos y geometría
      const differences: AttributeDifference[] = [];
      let fileFeatureRecord: Record<string, unknown> | null = null;
      let fileGeometry: Geometry | unknown | null = null;

      const whereConditions = dbSuidCols.map((colName) =>
        toSqlWhereCondition(colName, dbRec[colName], dbColumnTypes)
      );
      const whereClause = whereConditions.join(" AND ");

      if (dbfReader) {
        const fileRecordIndex = binaryFileIndices[dbIndex] ?? binaryFileIndices[0];

        fieldsToCompare.forEach((field) => {
          const dbVal = dbRec[field] !== undefined ? dbRec[field] : null;
          const fieldDescriptor = dbfCompareFields.get(field);

          if (fieldDescriptor) {
            const fileVal = dbfReader!.readFieldValue(fileRecordIndex, fieldDescriptor);
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
          }
        });

        if (shpReader) {
          fileGeometry = shpReader.readGeometry(fileRecordIndex);
        }
      } else {
        const objectFileRec = objectFileRecList[dbIndex] ?? objectFileRecList[0];
        fileFeatureRecord = objectFileRec;
        fileGeometry = objectFileGeoms[dbIndex] ?? objectFileGeoms[0];

        fieldsToCompare.forEach((field) => {
          const dbVal = dbRec[field] !== undefined ? dbRec[field] : null;
          const fileKey = fieldToFileKey.get(field);
          const fileVal = fileKey != null ? objectFileRec[fileKey] : null;

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
      }

      // Comparación geométrica espacial
      let isGeometryMismatch = false;
      let geometryDiffInfo: GeometryDifference | undefined = undefined;

      if (mappingConfig.compareGeometry && fileGeometry) {
        const dbGeom = extractDbGeometry(dbRec);
        if (dbGeom) {
          const geomResult = compareGeometries(dbGeom, fileGeometry);
          if (!geomResult.isMatch) {
            isGeometryMismatch = true;
            geometryDiffInfo = {
              dbType: geomResult.dbType,
              fileType: geomResult.fileType,
              details: geomResult.details || "Diferencia geométrica detectada",
              dbGeomRaw: dbGeom,
              fileGeomRaw: fileGeometry,
            };

            if (whereClause && geomResult.fileGeomNormalized) {
              const geomCol = findDbGeometryColumn(dbRec, dbColumnTypes) || "geom";
              const stGeomExpr = buildPostgisGeomExpr(
                geomResult.fileGeomNormalized,
                mappingConfig.targetSrid
              );
              updateStatements.push(
                `UPDATE "${dbSchemaName}"."${dbTableName}" SET "${geomCol}" = ${stGeomExpr} WHERE ${whereClause};`
              );
            }
          }
        }
      }

      const resolvedType = isDuplicate
        ? DiscrepancyType.DUPLICATE_SUID
        : isGeometryMismatch
          ? DiscrepancyType.GEOMETRY_MISMATCH
          : differences.length > 0
            ? DiscrepancyType.ATTRIBUTE_MISMATCH
            : DiscrepancyType.MATCH;

      if (resolvedType === DiscrepancyType.DUPLICATE_SUID) {
        duplicateSuidCount++;
      } else if (resolvedType === DiscrepancyType.GEOMETRY_MISMATCH) {
        geometryMismatchCount++;
      } else if (resolvedType === DiscrepancyType.ATTRIBUTE_MISMATCH) {
        attributeMismatchCount++;
      } else {
        // Coincidencia exacta: Incremento atómico para optimizar memoria RAM
        exactMatchesCount++;
      }

      // Almacenar ítem en el array únicamente si representa una discrepancia real
      if (resolvedType !== DiscrepancyType.MATCH) {
        if (dbfReader && !fileFeatureRecord) {
          const fileRecordIndex = binaryFileIndices[dbIndex] ?? binaryFileIndices[0];
          fileFeatureRecord = dbfReader.readRecord(fileRecordIndex);
        }

        discrepancyItems.push({
          id: `${isGeometryMismatch ? "geom-mismatch" : differences.length > 0 ? "mismatch" : "dup"}-${suidKey}-${dbIndex}`,
          suid: rawSuid,
          type: resolvedType,
          differences,
          geometryDifference: geometryDiffInfo,
          dbRecord: dbRec,
          shpFeatureProps: fileFeatureRecord || undefined,
          shpGeometry: fileGeometry || undefined,
          note: isDuplicate
            ? `SUID Duplicado (${dbRecList.length} en DB / ${fileMatchesCount} en Archivo)`
            : geometryDiffInfo
              ? geometryDiffInfo.details
              : undefined,
        });
      }

      if (processedDbRecordCount % 10_000 === 0) {
        emit("Comparando atributos y geometrías", processedDbRecordCount, totalDbRecords);
      }
    });
  });
  emit("Comparando atributos y geometrías", totalDbRecords, totalDbRecords);

  // ==========================================
  // FASE 5: Registros Exclusivos de Archivo y Generación de INSERT
  // ==========================================
  let totalUnmatchedFileRecords = 0;
  if (dbfReader) {
    binaryFileSuidMap.forEach((indices, suidKey) => {
      if (!processedSuids.has(suidKey)) {
        totalUnmatchedFileRecords += indices.length;
      }
    });
  } else {
    objectFileSuidMap.forEach((recList, suidKey) => {
      if (!processedSuids.has(suidKey)) {
        totalUnmatchedFileRecords += recList.length;
      }
    });
  }

  let processedInsertCount = 0;

  if (dbfReader) {
    binaryFileSuidMap.forEach((indices, suidKey) => {
      if (!processedSuids.has(suidKey)) {
        onlyInShpCount += indices.length;

        indices.forEach((recordIndex, occurrenceIndex) => {
          processedInsertCount++;
          const fileRec = dbfReader!.readRecord(recordIndex) || {};
          const fileGeom = shpReader ? shpReader.readGeometry(recordIndex) : undefined;
          const rawSuid =
            buildCompositeRawSuidFromRecord(fileRec, targetFileSuidCols) || suidKey;

          const differences: AttributeDifference[] = [];
          fieldsToCompare.forEach((field) => {
            const fieldDesc = dbfCompareFields.get(field);
            const fileVal = fieldDesc
              ? dbfReader!.readFieldValue(recordIndex, fieldDesc)
              : fileRec[field];
            if (cleanValue(fileVal) !== "") {
              differences.push({
                fieldName: field,
                dbValue: null,
                shpValue: fileVal as string | number | null,
              });
            }
          });

          discrepancyItems.push({
            id: `file-${suidKey}-${occurrenceIndex}`,
            suid: rawSuid,
            type: DiscrepancyType.ONLY_IN_SHP,
            differences,
            shpFeatureProps: fileRec,
            shpGeometry: fileGeom || undefined,
          });

          // Construcción de la sentencia INSERT INTO
          const insertCols: string[] = [];
          const insertVals: string[] = [];
          const addedCols = new Set<string>();

          dbSuidCols.forEach((col, columnIndex) => {
            const targetCol =
              targetFileSuidCols.length > 0
                ? targetFileSuidCols[columnIndex] || targetFileSuidCols[0]
                : undefined;
            const val = targetCol ? fileRec[targetCol] ?? fileRec[col] : fileRec[col];
            insertCols.push(`"${col}"`);
            insertVals.push(toSqlValue(val, col, dbColumnTypes));
            addedCols.add(col);
          });

          fieldsToCompare.forEach((field) => {
            if (addedCols.has(field)) return;
            const fieldDesc = dbfCompareFields.get(field);
            const fileVal = fieldDesc
              ? dbfReader!.readFieldValue(recordIndex, fieldDesc)
              : fileRec[field];
            if (fileVal !== undefined) {
              insertCols.push(`"${field}"`);
              insertVals.push(toSqlValue(fileVal, field, dbColumnTypes));
              addedCols.add(field);
            }
          });

          // Inclusión de Geometría PostGIS en la sentencia INSERT
          if (fileGeom) {
            const geomCol =
              findDbGeometryColumn(dbRecords[0], dbColumnTypes) ||
              (mappingConfig.compareGeometry ? "geom" : undefined);

            if (geomCol && !addedCols.has(geomCol)) {
              const stGeomExpr = buildPostgisGeomExpr(fileGeom, mappingConfig.targetSrid);
              insertCols.push(`"${geomCol}"`);
              insertVals.push(stGeomExpr);
              addedCols.add(geomCol);
            }
          }

          if (insertDefaults) {
            Object.entries(insertDefaults).forEach(([fieldName, defaultConfig]) => {
              if (addedCols.has(fieldName)) return;
              if (defaultConfig.value && defaultConfig.value.trim() !== "") {
                insertCols.push(`"${fieldName}"`);
                if (defaultConfig.useRawExpression) {
                  insertVals.push(defaultConfig.value.trim());
                } else {
                  insertVals.push(toSqlValue(defaultConfig.value, fieldName, dbColumnTypes));
                }
                addedCols.add(fieldName);
              }
            });
          }

          insertStatements.push(
            `INSERT INTO "${dbSchemaName}"."${dbTableName}" (${insertCols.join(", ")}) VALUES (${insertVals.join(", ")});`
          );

          if (processedInsertCount % 5_000 === 0) {
            emit("Generando sentencias INSERT", processedInsertCount, totalUnmatchedFileRecords);
          }
        });
      }
    });
  } else {
    objectFileSuidMap.forEach((fileRecList, suidKey) => {
      if (!processedSuids.has(suidKey)) {
        const fileGeomList = objectFileGeomMap.get(suidKey) ?? [];
        onlyInShpCount += fileRecList.length;

        fileRecList.forEach((fileRec, featureIndex) => {
          processedInsertCount++;
          const rawSuid =
            buildCompositeRawSuidFromRecord(fileRec, targetFileSuidCols) || suidKey;

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
            id: `file-${suidKey}-${featureIndex}`,
            suid: rawSuid,
            type: DiscrepancyType.ONLY_IN_SHP,
            differences,
            shpFeatureProps: fileRec,
            shpGeometry: fileGeomList[featureIndex] ?? fileGeomList[0],
          });

          const insertCols: string[] = [];
          const insertVals: string[] = [];
          const addedCols = new Set<string>();

          dbSuidCols.forEach((col, columnIndex) => {
            const targetCol =
              targetFileSuidCols.length > 0
                ? targetFileSuidCols[columnIndex] || targetFileSuidCols[0]
                : undefined;
            const val = targetCol ? fileRec[targetCol] ?? fileRec[col] : fileRec[col];
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

          const fileGeom = fileGeomList[featureIndex] ?? fileGeomList[0];
          if (fileGeom) {
            const geomCol =
              findDbGeometryColumn(dbRecords[0], dbColumnTypes) ||
              (mappingConfig.compareGeometry ? "geom" : undefined);

            if (geomCol && !addedCols.has(geomCol)) {
              const stGeomExpr = buildPostgisGeomExpr(fileGeom, mappingConfig.targetSrid);
              insertCols.push(`"${geomCol}"`);
              insertVals.push(stGeomExpr);
              addedCols.add(geomCol);
            }
          }

          if (insertDefaults) {
            Object.entries(insertDefaults).forEach(([fieldName, defaultConfig]) => {
              if (addedCols.has(fieldName)) return;
              if (defaultConfig.value && defaultConfig.value.trim() !== "") {
                insertCols.push(`"${fieldName}"`);
                if (defaultConfig.useRawExpression) {
                  insertVals.push(defaultConfig.value.trim());
                } else {
                  insertVals.push(toSqlValue(defaultConfig.value, fieldName, dbColumnTypes));
                }
                addedCols.add(fieldName);
              }
            });
          }

          insertStatements.push(
            `INSERT INTO "${dbSchemaName}"."${dbTableName}" (${insertCols.join(", ")}) VALUES (${insertVals.join(", ")});`
          );

          if (processedInsertCount % 5_000 === 0) {
            emit("Generando sentencias INSERT", processedInsertCount, totalUnmatchedFileRecords);
          }
        });
      }
    });
  }
  emit("Generando sentencias INSERT", totalUnmatchedFileRecords, totalUnmatchedFileRecords);

  const totalAnalyzed =
    exactMatchesCount +
    attributeMismatchCount +
    geometryMismatchCount +
    onlyInDbCount +
    onlyInShpCount +
    nullSuidCount +
    duplicateSuidCount;

  return {
    totalDbRecords,
    totalFileRecords,
    totalAnalyzed,
    exactMatchesCount,
    attributeMismatchCount,
    geometryMismatchCount,
    onlyInDbCount,
    onlyInShpCount,
    nullSuidCount,
    duplicateSuidCount,
    items: discrepancyItems,
    sqlUpdateScript: updateStatements.join("\n"),
    sqlInsertScript: insertStatements.join("\n"),
  };
}
