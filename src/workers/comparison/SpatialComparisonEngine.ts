import type {
  ColumnMappingConfig,
  ComparisonSummary,
  DiscrepancyItem,
} from "@/types/comparison";
import type { SerializableFileDataset } from "@/types/workerMessages";
import { BinaryDbfReader, type DbfFieldDescriptor } from "@/utils/binary/BinaryDbfReader";
import { BinaryShpReader } from "@/utils/binary/BinaryShpReader";
import { createProjectionConverter, ProjectionEngine } from "@/utils/spatial/ProjectionEngine";
import { FileDatasetIndexer } from "./FileDatasetIndexer";
import { SuidKeyResolver } from "./SuidKeyResolver";
import { NullRecordHandler } from "./NullRecordHandler";
import { SqlPatchGenerator } from "./SqlPatchGenerator";
import { FeatureAttributeExtractor } from "./FeatureAttributeExtractor";
import { GeometryDifferenceEvaluator } from "./GeometryDifferenceEvaluator";
import { MatchedRecordsComparator } from "./MatchedRecordsComparator";
import { UnmatchedFileFeaturesCollector } from "./UnmatchedFileFeaturesCollector";

/**
 * SpatialComparisonEngine.ts
 * High-level comparison orchestrator coordinating dataset indexing, Pass 1 matched comparison,
 * Pass 2 unmatched features collection, and zero-allocation SQL patch preview generation.
 */
export class SpatialComparisonEngine {
  private readonly suidResolver = new SuidKeyResolver();
  private readonly indexer = new FileDatasetIndexer(this.suidResolver);
  private readonly nullHandler = new NullRecordHandler();
  private readonly attributeExtractor = new FeatureAttributeExtractor(this.suidResolver);
  private readonly geometryEvaluator = new GeometryDifferenceEvaluator();
  private readonly matchedComparator = new MatchedRecordsComparator(
    this.suidResolver,
    this.attributeExtractor,
    this.geometryEvaluator
  );
  private readonly unmatchedCollector = new UnmatchedFileFeaturesCollector(this.suidResolver);

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

    const { dbfReader, shpReader, transformCoordinate, fileSrid } =
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
    const pass1Result = this.matchedComparator.compareMatchedRecords({
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
    const unmatchedFileItems = this.unmatchedCollector.collectUnmatchedFileFeatures({
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

    // 6. Generate SQL Patches (preview mode only: zero-memory allocation)
    emit("Generando vista previa SQL...", 0, allDiscrepancyItems.length);
    const sqlPatchGenerator = new SqlPatchGenerator(
      dbSchemaName,
      dbTableName,
      mappingConfig,
      dbColumnTypes,
      Boolean(dbfReader),
      shpReader,
      fileSrid
    );
    const patchResult = sqlPatchGenerator.generatePatches(allDiscrepancyItems, emit, false);

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
      targetSrid: mappingConfig.targetSrid,
      dbColumnTypes,
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
    let fileSrid: number | undefined;

    if (fileDataset.dbfBuffer) {
      dbfReader = new BinaryDbfReader(fileDataset.dbfBuffer, fileDataset.cpgText || "windows-1252");
    }
    if (fileDataset.shpBuffer) {
      shpReader = new BinaryShpReader(fileDataset.shpBuffer);
      if (fileDataset.prjText) {
        fileSrid = ProjectionEngine.extractEpsg(fileDataset.prjText) || undefined;
        transformCoordinate = createProjectionConverter(fileDataset.prjText);
      }
    }

    return { dbfReader, shpReader, transformCoordinate, fileSrid };
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
          (descriptorItem) => descriptorItem.name.toLowerCase() === fileKey.toLowerCase()
        );
        if (descriptor) {
          dbfCompareFields.set(field, descriptor);
        }
      });
    }
    return dbfCompareFields;
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
