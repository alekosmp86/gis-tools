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
import { SqlPatchGenerator } from "./SqlPatchGenerator";

interface PassCounts {
  exactMatchesCount: number;
  attributeMismatchCount: number;
  geometryMismatchCount: number;
  onlyInDbCount: number;
  duplicateSuidCount: number;
}

interface PassResult {
  discrepancyItems: DiscrepancyItem[];
  processedSuids: Set<string>;
  counts: PassCounts;
}

interface CompareMatchedParams {
  dbSuidMap: Map<string, Record<string, unknown>[]>;
  dbSuidCols: string[];
  fieldsToCompare: string[];
  fieldToFileKey: Map<string, string>;
  binaryFileSuidMap: Map<string, number[]>;
  objectFileSuidMap: Map<string, Record<string, unknown>[]>;
  dbfReader: BinaryDbfReader | null;
  shpReader: BinaryShpReader | null;
  transformCoordinate: ((coordinate: [number, number]) => [number, number]) | null;
  dbfCompareFields: Map<string, DbfFieldDescriptor>;
  mappingConfig: ColumnMappingConfig;
  emit: (phase: string, current: number, total: number) => void;
}

interface CollectUnmatchedParams {
  processedSuids: Set<string>;
  binaryFileSuidMap: Map<string, number[]>;
  objectFileSuidMap: Map<string, Record<string, unknown>[]>;
  targetFileSuidCols: string[];
  fieldsToCompare: string[];
  fieldToFileKey: Map<string, string>;
  dbfCompareFields: Map<string, DbfFieldDescriptor>;
  dbfReader: BinaryDbfReader | null;
  shpReader: BinaryShpReader | null;
  transformCoordinate: ((coordinate: [number, number]) => [number, number]) | null;
}

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

    const { dbSuidCols, targetFileSuidCols, fieldsToCompare, fieldToFileKey } =
      this.resolveMappingParameters(mappingConfig);

    const { dbfReader, shpReader, transformCoordinate } =
      this.initializeFileReaders(fileDataset);

    // 1. Index DB records
    emit("Indexando registros...", 0, dbRecords.length);
    const dbSuidMap = this.indexDatabaseRecords(dbRecords, dbSuidCols);

    // 2. Index File records
    const { binaryFileSuidMap, objectFileSuidMap, totalFileRecords, nullRecordItems } =
      this.indexFileRecords(fileDataset, targetFileSuidCols, dbfReader, shpReader, transformCoordinate);

    const dbfCompareFields = this.buildDbfFieldDescriptors(dbfReader, fieldsToCompare, fieldToFileKey);

    // 3. Pass 1: Compare Matched Records
    emit("Comparando registros...", 0, dbRecords.length);
    const pass1Result = this.compareMatchedRecords({
      dbSuidMap,
      dbSuidCols,
      fieldsToCompare,
      fieldToFileKey,
      binaryFileSuidMap,
      objectFileSuidMap,
      dbfReader,
      shpReader,
      transformCoordinate,
      dbfCompareFields,
      mappingConfig,
      emit,
    });

    // 4. Pass 2: Process features ONLY in file
    emit("Procesando registros solo en archivo...", dbRecords.length, dbRecords.length);
    const unmatchedFileItems = this.collectUnmatchedFileFeatures({
      processedSuids: pass1Result.processedSuids,
      binaryFileSuidMap,
      objectFileSuidMap,
      targetFileSuidCols,
      fieldsToCompare,
      fieldToFileKey,
      dbfCompareFields,
      dbfReader,
      shpReader,
      transformCoordinate,
    });

    // 5. Aggregate All Discrepancy Items
    const allDiscrepancyItems: DiscrepancyItem[] = [
      ...nullRecordItems,
      ...pass1Result.discrepancyItems,
      ...unmatchedFileItems,
    ];

    const totalAnalyzed =
      pass1Result.counts.exactMatchesCount +
      pass1Result.counts.attributeMismatchCount +
      pass1Result.counts.geometryMismatchCount +
      pass1Result.counts.onlyInDbCount +
      unmatchedFileItems.length +
      nullRecordItems.length +
      pass1Result.counts.duplicateSuidCount;

    // 6. Generate SQL Patches
    emit("Generando sentencias SQL...", 0, allDiscrepancyItems.length);
    const sqlPatchGenerator = new SqlPatchGenerator(
      dbSchemaName,
      dbTableName,
      mappingConfig,
      dbColumnTypes,
      Boolean(dbfReader)
    );
    const patchResult = sqlPatchGenerator.generatePatches(allDiscrepancyItems, emit);

    return {
      totalDbRecords: dbRecords.length,
      totalFileRecords,
      totalAnalyzed,
      exactMatchesCount: pass1Result.counts.exactMatchesCount,
      attributeMismatchCount: pass1Result.counts.attributeMismatchCount,
      geometryMismatchCount: pass1Result.counts.geometryMismatchCount,
      onlyInDbCount: pass1Result.counts.onlyInDbCount,
      onlyInShpCount: unmatchedFileItems.length,
      nullSuidCount: nullRecordItems.length,
      duplicateSuidCount: pass1Result.counts.duplicateSuidCount,
      items: allDiscrepancyItems,
      ...patchResult,
    };
  }

  private resolveMappingParameters(mappingConfig: ColumnMappingConfig) {
    const dbSuidCols = mappingConfig.suidColumns;
    const targetFileSuidCols =
      mappingConfig.matchedFileSuidColumns && mappingConfig.matchedFileSuidColumns.length > 0
        ? mappingConfig.matchedFileSuidColumns
        : dbSuidCols;

    const fieldsToCompare = mappingConfig.fieldsToCompare;
    const attributeMap = mappingConfig.attributeMap || {};

    const fieldToFileKey = new Map<string, string>();
    fieldsToCompare.forEach((field) => {
      const mapped = attributeMap[field] || field;
      fieldToFileKey.set(field, mapped);
    });

    return { dbSuidCols, targetFileSuidCols, fieldsToCompare, fieldToFileKey };
  }

  private initializeFileReaders(fileDataset: SerializableFileDataset) {
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

    return { dbfReader, shpReader, transformCoordinate };
  }

  private indexDatabaseRecords(
    dbRecords: Record<string, unknown>[],
    dbSuidCols: string[]
  ): Map<string, Record<string, unknown>[]> {
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
    return dbSuidMap;
  }

  private indexFileRecords(
    fileDataset: SerializableFileDataset,
    targetFileSuidCols: string[],
    dbfReader: BinaryDbfReader | null,
    shpReader: BinaryShpReader | null,
    transformCoordinate: ((coordinate: [number, number]) => [number, number]) | null
  ) {
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

    return { binaryFileSuidMap, objectFileSuidMap, totalFileRecords, nullRecordItems };
  }

  private buildDbfFieldDescriptors(
    dbfReader: BinaryDbfReader | null,
    fieldsToCompare: string[],
    fieldToFileKey: Map<string, string>
  ): Map<string, DbfFieldDescriptor> {
    const dbfCompareFields = new Map<string, DbfFieldDescriptor>();
    if (dbfReader) {
      fieldsToCompare.forEach((field) => {
        const fileKey = fieldToFileKey.get(field) || field;
        const descriptor = dbfReader.header.fields.find(
          (f) => f.name.toLowerCase() === fileKey.toLowerCase()
        );
        if (descriptor) {
          dbfCompareFields.set(field, descriptor);
        }
      });
    }
    return dbfCompareFields;
  }

  private compareMatchedRecords(params: CompareMatchedParams): PassResult {
    const {
      dbSuidMap,
      dbSuidCols,
      fieldsToCompare,
      fieldToFileKey,
      binaryFileSuidMap,
      objectFileSuidMap,
      dbfReader,
      shpReader,
      transformCoordinate,
      dbfCompareFields,
      mappingConfig,
      emit,
    } = params;

    const discrepancyItems: DiscrepancyItem[] = [];
    const processedSuids = new Set<string>();
    let exactMatchesCount = 0;
    let attributeMismatchCount = 0;
    let geometryMismatchCount = 0;
    let onlyInDbCount = 0;
    let duplicateSuidCount = 0;

    let processedDbRecordCount = 0;
    const totalDbSuidEntries = dbSuidMap.size;

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
          const differences = this.computeOnlyInDbDifferences(dbRec, fieldsToCompare);
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

        const { differences, fileFeatureRecord, fileGeometry } = this.extractFeatureAttributesAndGeometry({
          dbRec,
          dbIndex,
          fieldsToCompare,
          fieldToFileKey,
          binaryFileIndices,
          objectFileRecList,
          objectFileGeoms,
          dbfReader,
          shpReader,
          transformCoordinate,
          dbfCompareFields,
        });

        const { isGeometryDifferent, geometryDiffDetails } = this.evaluateGeometryDifference(
          dbRec,
          fileGeometry,
          mappingConfig.compareGeometry
        );

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
      });

      if (processedDbRecordCount % 10_000 === 0) {
        emit("Comparando registros...", processedDbRecordCount, totalDbSuidEntries);
      }
    });

    return {
      discrepancyItems,
      processedSuids,
      counts: {
        exactMatchesCount,
        attributeMismatchCount,
        geometryMismatchCount,
        onlyInDbCount,
        duplicateSuidCount,
      },
    };
  }

  private computeOnlyInDbDifferences(
    dbRec: Record<string, unknown>,
    fieldsToCompare: string[]
  ): AttributeDifference[] {
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
    return differences;
  }

  private extractFeatureAttributesAndGeometry(params: {
    dbRec: Record<string, unknown>;
    dbIndex: number;
    fieldsToCompare: string[];
    fieldToFileKey: Map<string, string>;
    binaryFileIndices: number[];
    objectFileRecList: Record<string, unknown>[];
    objectFileGeoms: unknown[];
    dbfReader: BinaryDbfReader | null;
    shpReader: BinaryShpReader | null;
    transformCoordinate: ((coordinate: [number, number]) => [number, number]) | null;
    dbfCompareFields: Map<string, DbfFieldDescriptor>;
  }) {
    const {
      dbRec,
      dbIndex,
      fieldsToCompare,
      fieldToFileKey,
      binaryFileIndices,
      objectFileRecList,
      objectFileGeoms,
      dbfReader,
      shpReader,
      transformCoordinate,
      dbfCompareFields,
    } = params;

    const differences: AttributeDifference[] = [];
    let fileFeatureRecord: Record<string, unknown> | null = null;
    let fileGeometry: Geometry | unknown | null = null;

    if (dbfReader) {
      const fileRecordIndex = binaryFileIndices[dbIndex] ?? binaryFileIndices[0];

      fieldsToCompare.forEach((field) => {
        const dbVal = dbRec[field] !== undefined ? dbRec[field] : null;
        const fieldDescriptor = dbfCompareFields.get(field);

        if (fieldDescriptor) {
          const fileVal = dbfReader.readFieldValue(fileRecordIndex, fieldDescriptor);
          const dbCleaned = this.suidResolver.cleanRawValue(dbVal);
          const fileCleaned = this.suidResolver.cleanRawValue(fileVal);

          if (dbCleaned !== fileCleaned) {
            differences.push({
              fieldName: field,
              dbValue: dbVal as string | number | null,
              shpValue: fileVal as string | number | null,
            });
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
        }
      });
    }

    return { differences, fileFeatureRecord, fileGeometry };
  }

  private evaluateGeometryDifference(
    dbRec: Record<string, unknown>,
    fileGeometry: unknown,
    compareGeometryEnabled: boolean
  ) {
    if (!compareGeometryEnabled) {
      return { isGeometryDifferent: false, geometryDiffDetails: undefined };
    }

    const dbGeom =
      dbRec.geom ??
      dbRec.geometry ??
      dbRec.wkb_geometry ??
      dbRec.wkt ??
      dbRec.the_geom;

    if (dbGeom && fileGeometry) {
      const geoCompResult = compareGeometries(dbGeom, fileGeometry);
      if (!geoCompResult.isMatch) {
        return {
          isGeometryDifferent: true,
          geometryDiffDetails: geoCompResult.details,
        };
      }
    }

    return { isGeometryDifferent: false, geometryDiffDetails: undefined };
  }

  private collectUnmatchedFileFeatures(params: CollectUnmatchedParams): DiscrepancyItem[] {
    const {
      processedSuids,
      binaryFileSuidMap,
      objectFileSuidMap,
      targetFileSuidCols,
      fieldsToCompare,
      fieldToFileKey,
      dbfCompareFields,
      dbfReader,
      shpReader,
      transformCoordinate,
    } = params;

    const unmatchedItems: DiscrepancyItem[] = [];

    if (dbfReader) {
      binaryFileSuidMap.forEach((indices, suidKey) => {
        if (!processedSuids.has(suidKey)) {
          indices.forEach((recordIndex, occurrenceIndex) => {
            const fileRec = dbfReader.readRecord(recordIndex) || {};
            const fileGeom = shpReader
              ? shpReader.readGeometry(recordIndex, transformCoordinate)
              : undefined;
            const rawSuid =
              this.suidResolver.buildCompositeRawSuid(fileRec, targetFileSuidCols) || suidKey;

            const differences: AttributeDifference[] = [];
            fieldsToCompare.forEach((field) => {
              const fieldDesc = dbfCompareFields.get(field);
              const fileVal = fieldDesc
                ? dbfReader.readFieldValue(recordIndex, fieldDesc)
                : fileRec[field];
              if (this.suidResolver.cleanRawValue(fileVal) !== "") {
                differences.push({
                  fieldName: field,
                  dbValue: null,
                  shpValue: fileVal as string | number | null,
                });
              }
            });

            unmatchedItems.push({
              id: `file-${suidKey}-${occurrenceIndex}`,
              suid: rawSuid,
              type: DiscrepancyType.ONLY_IN_SHP,
              differences,
              shpFeatureProps: fileRec,
              shpGeometry: fileGeom || undefined,
            });
          });
        }
      });
    } else {
      objectFileSuidMap.forEach((recList, suidKey) => {
        if (!processedSuids.has(suidKey)) {
          const fileGeomList = recList.map((rec) => rec._geometry);

          recList.forEach((fileRec, featureIndex) => {
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

            unmatchedItems.push({
              id: `file-${suidKey}-${featureIndex}`,
              suid: rawSuid,
              type: DiscrepancyType.ONLY_IN_SHP,
              differences,
              shpFeatureProps: fileRec,
              shpGeometry: fileGeomList[featureIndex] ?? fileGeomList[0],
            });
          });
        }
      });
    }

    return unmatchedItems;
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
