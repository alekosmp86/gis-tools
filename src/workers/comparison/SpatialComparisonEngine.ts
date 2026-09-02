import type {
  ColumnMappingConfig,
  ComparisonSummary,
  DiscrepancyItem,
  AttributeDifference,
} from "@/types/comparison";
import { DiscrepancyType } from "@/types/comparison";
import type { SerializableFileDataset } from "@/types/workerMessages";
import { compareGeometries } from "@/utils/spatial/SpatialGeometryComparator";
import { BinaryDbfReader, type DbfFieldDescriptor } from "@/utils/binary/BinaryDbfReader";
import { BinaryShpReader } from "@/utils/binary/BinaryShpReader";
import { createProjectionConverter } from "@/utils/spatial/ProjectionEngine";
import type { Geometry } from "geojson";

import { FileDatasetIndexer } from "./FileDatasetIndexer";
import { SuidKeyResolver } from "./SuidKeyResolver";
import { NullRecordHandler } from "./NullRecordHandler";
import { SqlScriptBuilder } from "./SqlScriptBuilder";

export class SpatialComparisonEngine {
  private readonly suidResolver = new SuidKeyResolver();
  private readonly indexer = new FileDatasetIndexer(this.suidResolver);
  private readonly nullHandler = new NullRecordHandler();

  public executeComparison(
    dbRecords: Record<string, unknown>[],
    dbColumnTypes: Record<string, string> | undefined,
    fileDataset: SerializableFileDataset,
    mappingConfig: ColumnMappingConfig,
    dbSchemaName: string,
    dbTableName: string,
    onProgress?: (phase: string, current: number, total: number) => void
  ): ComparisonSummary {
    const emit = (phase: string, current: number, total: number) => {
      if (onProgress) onProgress(phase, current, total);
    };

    const sqlBuilder = new SqlScriptBuilder(
      dbSchemaName,
      dbTableName,
      dbColumnTypes,
      mappingConfig.targetSrid
    );

    const dbSuidCols = mappingConfig.suidColumns;
    const targetFileSuidCols =
      mappingConfig.matchedFileSuidColumns && mappingConfig.matchedFileSuidColumns.length > 0
        ? mappingConfig.matchedFileSuidColumns
        : dbSuidCols;

    const fieldsToCompare = mappingConfig.fieldsToCompare;
    const attributeMap = mappingConfig.attributeMap || {};
    const insertDefaults = mappingConfig.insertDefaults;

    // Direct lookups for attribute mapping
    const fieldToFileKey = new Map<string, string>();
    fieldsToCompare.forEach((field) => {
      const mapped = attributeMap[field] || field;
      fieldToFileKey.set(field, mapped);
    });

    let dbfReader: BinaryDbfReader | null = null;
    let shpReader: BinaryShpReader | null = null;
    let transformCoordinate: ((coordinate: [number, number]) => [number, number]) | null = null;

    if (fileDataset.dbfBuffer) {
      dbfReader = new BinaryDbfReader(fileDataset.dbfBuffer, fileDataset.cpgText || "windows-1252");
    }
    if (fileDataset.shpBuffer) {
      shpReader = new BinaryShpReader(fileDataset.shpBuffer);
      if (fileDataset.prjText) {
        transformCoordinate = createProjectionConverter(fileDataset.prjText);
      }
    }

    emit("Indexando registros...", 0, dbRecords.length);

    // Index DB records
    const dbSuidMap = new Map<string, Record<string, unknown>[]>();
    dbRecords.forEach((record) => {
      const suidKey = this.suidResolver.buildCompositeKey(record, dbSuidCols);
      if (suidKey) {
        const existingList = dbSuidMap.get(suidKey);
        if (existingList) {
          existingList.push(record);
        } else {
          dbSuidMap.set(suidKey, [record]);
        }
      }
    });

    // Index File records
    let binaryFileSuidMap = new Map<string, number[]>();
    let objectFileSuidMap = new Map<string, Record<string, unknown>[]>();
    let totalFileRecords = 0;
    let nullRecordItems: DiscrepancyItem[] = [];

    if (dbfReader) {
      const indexResult = this.indexer.indexBinaryDbf(dbfReader, targetFileSuidCols);
      binaryFileSuidMap = indexResult.suidMap;
      totalFileRecords = indexResult.totalRecords;
      nullRecordItems = this.nullHandler.processDbfNulls(
        indexResult.nullRecordIndices,
        dbfReader,
        shpReader || undefined,
        transformCoordinate
      );
    } else {
      const indexResult = this.indexer.indexObjectDataset(fileDataset, targetFileSuidCols);
      objectFileSuidMap = indexResult.suidMap;
      totalFileRecords = indexResult.totalRecords;
      nullRecordItems = this.nullHandler.processObjectNulls(indexResult.nullRecords);
    }

    const totalDbRecords = dbRecords.length;
    let exactMatchesCount = 0;
    let attributeMismatchCount = 0;
    let geometryMismatchCount = 0;
    let onlyInDbCount = 0;
    let onlyInShpCount = 0;
    const nullSuidCount = nullRecordItems.length;
    let duplicateSuidCount = 0;

    const discrepancyItems: DiscrepancyItem[] = [...nullRecordItems];
    const updateStatements: string[] = [];
    const insertStatements: string[] = [];
    const updatePreviewStatements: string[] = [];
    const insertPreviewStatements: string[] = [];
    const maxPreviewLimit = 500;
    let sqlUpdateCount = 0;
    let sqlInsertCount = 0;

    const dbfCompareFields = new Map<string, DbfFieldDescriptor>();
    if (dbfReader) {
      fieldsToCompare.forEach((field) => {
        const fileKey = fieldToFileKey.get(field) || field;
        const descriptor = dbfReader!.header.fields.find(
          (f) => f.name.toLowerCase() === fileKey.toLowerCase()
        );
        if (descriptor) {
          dbfCompareFields.set(field, descriptor);
        }
      });
    }

    const processedSuids = new Set<string>();
    let processedDbRecordCount = 0;

    emit("Comparando registros...", 0, totalDbRecords);

    dbSuidMap.forEach((dbRecList, suidKey) => {
      processedSuids.add(suidKey);

      const binaryFileIndices = binaryFileSuidMap.get(suidKey) || [];
      const objectFileRecList = objectFileSuidMap.get(suidKey) || [];
      const objectFileGeoms = objectFileRecList.map((rec) => rec._geometry);

      const fileMatchesCount = dbfReader ? binaryFileIndices.length : objectFileRecList.length;
      const isDuplicate = dbRecList.length > 1 || fileMatchesCount > 1;

      dbRecList.forEach((dbRec, dbIndex) => {
        processedDbRecordCount++;
        const rawSuid = this.suidResolver.buildCompositeRawSuid(dbRec, dbSuidCols) || suidKey;

        if (fileMatchesCount === 0) {
          const differences: AttributeDifference[] = [];
          fieldsToCompare.forEach((field) => {
            const dbVal = dbRec[field] !== undefined ? dbRec[field] : null;
            if (this.suidResolver.cleanRawValue(dbVal) !== "") {
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

        const differences: AttributeDifference[] = [];
        let fileFeatureRecord: Record<string, unknown> | null = null;
        let fileGeometry: Geometry | unknown | null = null;

        const whereConditions = dbSuidCols.map((colName) =>
          sqlBuilder.formatWhereCondition(colName, dbRec[colName])
        );
        const whereClause = whereConditions.join(" AND ");

        if (dbfReader) {
          const fileRecordIndex = binaryFileIndices[dbIndex] ?? binaryFileIndices[0];

          fieldsToCompare.forEach((field) => {
            const dbVal = dbRec[field] !== undefined ? dbRec[field] : null;
            const fieldDescriptor = dbfCompareFields.get(field);

            if (fieldDescriptor) {
              const fileVal = dbfReader!.readFieldValue(fileRecordIndex, fieldDescriptor);
              const dbCleaned = this.suidResolver.cleanRawValue(dbVal);
              const fileCleaned = this.suidResolver.cleanRawValue(fileVal);

              if (dbCleaned !== fileCleaned) {
                differences.push({
                  fieldName: field,
                  dbValue: dbVal as string | number | null,
                  shpValue: fileVal as string | number | null,
                });

                if (whereClause) {
                  const updateSql = sqlBuilder.buildUpdateStatement(field, fileVal, whereClause);
                  sqlUpdateCount++;
                  if (updatePreviewStatements.length < maxPreviewLimit) {
                    updatePreviewStatements.push(updateSql);
                  }
                  updateStatements.push(updateSql);
                }
              }
            }
          });

          if (shpReader) {
            fileGeometry = shpReader.readGeometry(fileRecordIndex, transformCoordinate);
          }
        } else {
          const objectFileRec = objectFileRecList[dbIndex] ?? objectFileRecList[0];
          fileFeatureRecord = objectFileRec;
          fileGeometry = objectFileGeoms[dbIndex] ?? objectFileGeoms[0];

          fieldsToCompare.forEach((field) => {
            const dbVal = dbRec[field] !== undefined ? dbRec[field] : null;
            const fileKey = fieldToFileKey.get(field);
            const fileVal = fileKey != null ? objectFileRec[fileKey] : null;

            const dbCleaned = this.suidResolver.cleanRawValue(dbVal);
            const fileCleaned = this.suidResolver.cleanRawValue(fileVal);

            if (dbCleaned !== fileCleaned) {
              differences.push({
                fieldName: field,
                dbValue: dbVal as string | number | null,
                shpValue: fileVal as string | number | null,
              });

              if (whereClause) {
                const updateSql = sqlBuilder.buildUpdateStatement(field, fileVal, whereClause);
                sqlUpdateCount++;
                if (updatePreviewStatements.length < maxPreviewLimit) {
                  updatePreviewStatements.push(updateSql);
                }
                updateStatements.push(updateSql);
              }
            }
          });
        }

        let isGeometryDifferent = false;
        let geometryDiffDetails: string | undefined;

        if (mappingConfig.compareGeometry) {
          const dbGeom =
            dbRec.geom ??
            dbRec.geometry ??
            dbRec.wkb_geometry ??
            dbRec.wkt ??
            dbRec.the_geom;

          if (dbGeom && fileGeometry) {
            const geoCompResult = compareGeometries(dbGeom, fileGeometry);
            if (!geoCompResult.isMatch) {
              isGeometryDifferent = true;
              geometryDiffDetails = geoCompResult.details;
            }
          }
        }

        let resolvedType: DiscrepancyType;
        if (isDuplicate) {
          resolvedType = DiscrepancyType.DUPLICATE_SUID;
          duplicateSuidCount++;
        } else if (isGeometryDifferent) {
          resolvedType = DiscrepancyType.GEOMETRY_MISMATCH;
          geometryMismatchCount++;
        } else if (differences.length > 0) {
          resolvedType = DiscrepancyType.ATTRIBUTE_MISMATCH;
          attributeMismatchCount++;
        } else {
          resolvedType = DiscrepancyType.MATCH;
          exactMatchesCount++;
        }

        if (resolvedType !== DiscrepancyType.MATCH) {
          discrepancyItems.push({
            id: `match-${suidKey}-${dbIndex}`,
            suid: rawSuid,
            type: resolvedType,
            differences,
            geometryDifference: isGeometryDifferent
              ? {
                  details: geometryDiffDetails || "Geometría espacial no coincide",
                  dbGeomRaw: dbRec.geom || dbRec.geometry,
                  fileGeomRaw: fileGeometry,
                }
              : undefined,
            dbRecord: dbRec,
            shpFeatureProps:
              fileFeatureRecord ||
              (dbfReader
                ? dbfReader.readRecord(binaryFileIndices[dbIndex] ?? binaryFileIndices[0]) || undefined
                : undefined),
            shpGeometry: fileGeometry || undefined,
            note: isDuplicate
              ? `SUID Duplicado (${dbRecList.length} en DB / ${fileMatchesCount} en Archivo)`
              : undefined,
          });
        }

        if (processedDbRecordCount % 10_000 === 0) {
          emit("Comparando registros...", processedDbRecordCount, totalDbRecords);
        }
      });
    });

    emit("Procesando registros solo en archivo...", totalDbRecords, totalDbRecords);

    // Pass 2: Process features ONLY in file
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
            const fileGeom = shpReader
              ? shpReader.readGeometry(recordIndex, transformCoordinate)
              : undefined;
            const rawSuid =
              this.suidResolver.buildCompositeRawSuid(fileRec, targetFileSuidCols) || suidKey;

            const differences: AttributeDifference[] = [];
            fieldsToCompare.forEach((field) => {
              const fieldDesc = dbfCompareFields.get(field);
              const fileVal = fieldDesc
                ? dbfReader!.readFieldValue(recordIndex, fieldDesc)
                : fileRec[field];
              if (this.suidResolver.cleanRawValue(fileVal) !== "") {
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

            // Build INSERT statement
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
              insertVals.push(sqlBuilder.formatSqlValue(val, col));
              addedCols.add(col);
            });

            fieldsToCompare.forEach((field) => {
              if (addedCols.has(field)) return;
              const fieldDesc = dbfCompareFields.get(field);
              const val = fieldDesc
                ? dbfReader!.readFieldValue(recordIndex, fieldDesc)
                : fileRec[field];
              if (val !== undefined && val !== null) {
                insertCols.push(`"${field}"`);
                insertVals.push(sqlBuilder.formatSqlValue(val, field));
                addedCols.add(field);
              }
            });

            if (fileGeom) {
              const geomCol =
                SqlScriptBuilder.findDbGeometryColumn(dbRecords[0], dbColumnTypes) ||
                (mappingConfig.compareGeometry ? "geom" : undefined);

              if (geomCol && !addedCols.has(geomCol)) {
                insertCols.push(`"${geomCol}"`);
                insertVals.push(sqlBuilder.buildPostgisGeomExpr(fileGeom));
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
                    insertVals.push(sqlBuilder.formatSqlValue(defaultConfig.value, fieldName));
                  }
                  addedCols.add(fieldName);
                }
              });
            }

            const insertSql = sqlBuilder.buildInsertStatement(insertCols, insertVals);
            sqlInsertCount++;
            if (insertPreviewStatements.length < maxPreviewLimit) {
              insertPreviewStatements.push(insertSql);
            }
            insertStatements.push(insertSql);

            if (processedInsertCount % 5_000 === 0) {
              emit("Generando sentencias INSERT", processedInsertCount, totalUnmatchedFileRecords);
            }
          });
        }
      });
    } else {
      objectFileSuidMap.forEach((recList, suidKey) => {
        if (!processedSuids.has(suidKey)) {
          onlyInShpCount += recList.length;

          const fileGeomList = recList.map((rec) => rec._geometry);

          recList.forEach((fileRec, featureIndex) => {
            processedInsertCount++;
            const rawSuid =
              this.suidResolver.buildCompositeRawSuid(fileRec, targetFileSuidCols) || suidKey;

            const differences: AttributeDifference[] = [];
            fieldsToCompare.forEach((field) => {
              const fileKey = fieldToFileKey.get(field);
              const fileVal = fileKey != null ? fileRec[fileKey] : null;
              if (this.suidResolver.cleanRawValue(fileVal) !== "") {
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
              insertVals.push(sqlBuilder.formatSqlValue(val, col));
              addedCols.add(col);
            });

            fieldsToCompare.forEach((field) => {
              if (addedCols.has(field)) return;
              const fileKey = fieldToFileKey.get(field);
              if (fileKey != null) {
                insertCols.push(`"${field}"`);
                insertVals.push(sqlBuilder.formatSqlValue(fileRec[fileKey], field));
                addedCols.add(field);
              }
            });

            const fileGeom = fileGeomList[featureIndex] ?? fileGeomList[0];
            if (fileGeom) {
              const geomCol =
                SqlScriptBuilder.findDbGeometryColumn(dbRecords[0], dbColumnTypes) ||
                (mappingConfig.compareGeometry ? "geom" : undefined);

              if (geomCol && !addedCols.has(geomCol)) {
                insertCols.push(`"${geomCol}"`);
                insertVals.push(sqlBuilder.buildPostgisGeomExpr(fileGeom));
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
                    insertVals.push(sqlBuilder.formatSqlValue(defaultConfig.value, fieldName));
                  }
                  addedCols.add(fieldName);
                }
              });
            }

            const insertSql = sqlBuilder.buildInsertStatement(insertCols, insertVals);
            sqlInsertCount++;
            if (insertPreviewStatements.length < maxPreviewLimit) {
              insertPreviewStatements.push(insertSql);
            }
            insertStatements.push(insertSql);

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

    const sqlUpdatePreview =
      updatePreviewStatements.join("\n") +
      (sqlUpdateCount > maxPreviewLimit
        ? `\n\n-- ==========================================================================================\n` +
          `-- ⚡ VISTA PREVIA TRUNCADA EN NAVEGADOR POR RENDIMIENTO\n` +
          `-- Se están mostrando las primeras ${maxPreviewLimit} sentencias de ${sqlUpdateCount.toLocaleString("es-UY")} sentencias totales.\n` +
          `-- El script completo está disponible intacto para Copiar, Descargar (.sql) o Ejecutar en BD.\n` +
          `-- ==========================================================================================`
        : "");

    const sqlInsertPreview =
      insertPreviewStatements.join("\n") +
      (sqlInsertCount > maxPreviewLimit
        ? `\n\n-- ==========================================================================================\n` +
          `-- ⚡ VISTA PREVIA TRUNCADA EN NAVEGADOR POR RENDIMIENTO\n` +
          `-- Se están mostrando las primeras ${maxPreviewLimit} sentencias de ${sqlInsertCount.toLocaleString("es-UY")} sentencias totales.\n` +
          `-- El script completo está disponible intacto para Copiar, Descargar (.sql) o Ejecutar en BD.\n` +
          `-- ==========================================================================================`
        : "");

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
      sqlUpdateCount,
      sqlInsertCount,
      sqlUpdatePreview,
      sqlInsertPreview,
    };
  }

  public static compareDatasets(
    dbRecords: Record<string, unknown>[],
    dbColumnTypes: Record<string, string> | undefined,
    fileDataset: SerializableFileDataset,
    mappingConfig: ColumnMappingConfig,
    dbSchemaName: string,
    dbTableName: string,
    onProgress?: (phase: string, current: number, total: number) => void
  ): ComparisonSummary {
    const engine = new SpatialComparisonEngine();
    return engine.executeComparison(
      dbRecords,
      dbColumnTypes,
      fileDataset,
      mappingConfig,
      dbSchemaName,
      dbTableName,
      onProgress
    );
  }
}

/** Convenience export */
export const executeComparison = SpatialComparisonEngine.compareDatasets;
