import type {
  ColumnMappingConfig,
  DiscrepancyItem,
} from "@/types/comparison";
import { DiscrepancyType } from "@/types/comparison";
import type { BinaryDbfReader, DbfFieldDescriptor } from "@/utils/binary/BinaryDbfReader";
import type { BinaryShpReader } from "@/utils/binary/BinaryShpReader";
import type { SuidKeyResolver } from "./SuidKeyResolver";
import type { FeatureAttributeExtractor } from "./FeatureAttributeExtractor";
import type { GeometryDifferenceEvaluator } from "./GeometryDifferenceEvaluator";

export interface PassCounts {
  exactMatchesCount: number;
  attributeMismatchCount: number;
  geometryMismatchCount: number;
  onlyInDbCount: number;
  duplicateSuidCount: number;
}

export interface MatchedComparisonResult {
  discrepancyItems: DiscrepancyItem[];
  processedSuids: Set<string>;
  counts: PassCounts;
}

export interface CompareMatchedRecordsParams {
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

/**
 * MatchedRecordsComparator.ts
 * Executes Pass 1 of the comparison: matches database records against file features by SUID,
 * evaluates attribute and geometric differences, and detects duplicate keys.
 */
export class MatchedRecordsComparator {
  private readonly suidResolver: SuidKeyResolver;
  private readonly attributeExtractor: FeatureAttributeExtractor;
  private readonly geometryEvaluator: GeometryDifferenceEvaluator;

  constructor(
    suidResolver: SuidKeyResolver,
    attributeExtractor: FeatureAttributeExtractor,
    geometryEvaluator: GeometryDifferenceEvaluator
  ) {
    this.suidResolver = suidResolver;
    this.attributeExtractor = attributeExtractor;
    this.geometryEvaluator = geometryEvaluator;
  }

  public compareMatchedRecords(params: CompareMatchedRecordsParams): MatchedComparisonResult {
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
            differences: [],
            duplicateDetails: isDuplicate
              ? {
                  targetCount: dbRecList.length,
                  sourceCount: 0,
                }
              : undefined,
            note: isDuplicate
              ? `SUID Duplicado (${dbRecList.length} en DB / 0 en Archivo)`
              : undefined,
          });
          return;
        }

        const { differences, fileFeatureRecord, fileGeometry, fileRecordIndex } =
          this.attributeExtractor.extractFeatureAttributesAndGeometry({
            dbRecord: dbRec,
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

        const { isGeometryDifferent, geometryDiffDetails, resolvedDbGeom, resolvedFileGeom } =
          this.geometryEvaluator.evaluateGeometryDifference(
            dbRec,
            fileFeatureRecord || undefined,
            fileGeometry,
            mappingConfig
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
                  dbGeomRaw: resolvedDbGeom || dbRec.geom_wkb || dbRec.geom || dbRec.geometry,
                  fileGeomRaw: resolvedFileGeom || fileGeometry,
                }
              : undefined,
            dbRecord: dbRec,
            shpFeatureProps:
              fileFeatureRecord ||
              (dbfReader
                ? dbfReader.readRecord(binaryFileIndices[dbIndex] ?? binaryFileIndices[0]) || undefined
                : undefined),
            shpGeometry: resolvedFileGeom || fileGeometry || undefined,
            fileRecordIndex,
            duplicateDetails: isDuplicate
              ? {
                  targetCount: dbRecList.length,
                  sourceCount: fileMatchesCount,
                }
              : undefined,
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
}
