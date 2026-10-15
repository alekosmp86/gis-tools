import {
  PairingMethod,
  type ColumnMappingConfig,
  type DiscrepancyItem,
  type ItemPairing,
} from "@/core/types/comparison";
import type { BinaryDbfReader, DbfFieldDescriptor } from "@/core/binary/BinaryDbfReader";
import type { BinaryShpReader } from "@/core/binary/BinaryShpReader";
import type { SuidKeyOptions, SuidKeyResolver } from "./SuidKeyResolver";
import type { FeatureAttributeExtractor } from "./FeatureAttributeExtractor";
import type { GeometryDifferenceEvaluator } from "./GeometryDifferenceEvaluator";
import { buildContentSignature, type ContentSignatureOptions } from "./ContentSignature";
import {
  buildDuplicateDbItem,
  buildDuplicateFileItem,
  buildOnlyInDbItem,
  buildOnlyInFileItem,
  buildPairedItem,
  duplicateNote,
  repeatedKeyNote,
} from "./DiscrepancyItemBuilders";
import {
  fingerprintRoundedGeometry,
  MAX_PAIRING_CANDIDATES,
  pairKeyGroup,
  type KeyGroupPairingResult,
  type PairedRows,
  type PairingRow,
} from "./KeyGroupPairing";

export interface PassCounts {
  exactMatchesCount: number;
  attributeMismatchCount: number;
  geometryMismatchCount: number;
  onlyInDbCount: number;
  duplicateSuidCount: number;
  onlyInFileCount: number;
  duplicateSuidFileCount: number;
  duplicateFileRowsSkipped: number;
}

export interface MatchedComparisonResult {
  discrepancyItems: DiscrepancyItem[];
  unmatchedFileItems: DiscrepancyItem[];
  processedSuids: Set<string>;
  counts: PassCounts;
  pairingCappedGroups: number;
}

export interface CompareMatchedRecordsParams {
  dbSuidMap: Map<string, Record<string, unknown>[]>;
  dbSuidCols: string[];
  targetFileSuidCols?: string[];
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

interface FileRow {
  ordinal: number;
  record: Record<string, unknown>;
  geometry: unknown;
  recordIndex?: number;
}

interface RunState {
  params: CompareMatchedRecordsParams;
  keyOptions: SuidKeyOptions;
  items: DiscrepancyItem[];
  fileItems: DiscrepancyItem[];
  counts: PassCounts;
  cappedGroups: number;
}

interface GroupContext {
  suidKey: string;
  dbRecList: Record<string, unknown>[];
  fileRows: FileRow[];
}

interface PairRequest {
  suidKey: string;
  dbRecord: Record<string, unknown>;
  dbIndex: number;
  rawSuid: string;
  fileRow?: FileRow;
  pairing?: ItemPairing;
}

const PROGRESS_EMIT_INTERVAL = 10_000;

function attributeOnlyFingerprint(): string {
  return "";
}

function readFileValue(record: Record<string, unknown>, fileKey: string): unknown {
  if (record[fileKey] !== undefined) return record[fileKey];
  const lowerKey = fileKey.toLowerCase();
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === lowerKey) return value;
  }
  return null;
}

/**
 * MatchedRecordsComparator.ts
 * Executes Pass 1 of the comparison: matches database records against file features by SUID.
 * Keys with exactly one row per side are compared 1:1. Keys with several rows on either side
 * (collision groups) are paired row by row (see KeyGroupPairing) so attribute and geometry
 * changes stay visible; rows that cannot be paired are reported as only-in-side or DUPLICATE_SUID.
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
    const run = this.createRun(params);
    const processedSuids = new Set<string>();
    let processedDbRecordCount = 0;
    let lastEmittedMilestone = 0;
    let totalDbRecords = 0;
    params.dbSuidMap.forEach((dbRecList) => {
      totalDbRecords += dbRecList.length;
    });

    params.dbSuidMap.forEach((dbRecList, suidKey) => {
      processedSuids.add(suidKey);
      processedDbRecordCount += dbRecList.length;
      this.processKey(run, suidKey, dbRecList);

      const milestone = Math.floor(processedDbRecordCount / PROGRESS_EMIT_INTERVAL);
      if (milestone !== lastEmittedMilestone) {
        lastEmittedMilestone = milestone;
        params.emit("Comparando registros...", processedDbRecordCount, totalDbRecords);
      }
    });

    return {
      discrepancyItems: run.items,
      unmatchedFileItems: run.fileItems,
      processedSuids,
      counts: run.counts,
      pairingCappedGroups: run.cappedGroups,
    };
  }

  private createRun(params: CompareMatchedRecordsParams): RunState {
    return {
      params,
      keyOptions: {
        treatPlaceholdersAsEmpty: Boolean(params.mappingConfig.treatPlaceholdersAsEmpty),
      },
      items: [],
      fileItems: [],
      counts: {
        exactMatchesCount: 0,
        attributeMismatchCount: 0,
        geometryMismatchCount: 0,
        onlyInDbCount: 0,
        duplicateSuidCount: 0,
        onlyInFileCount: 0,
        duplicateSuidFileCount: 0,
        duplicateFileRowsSkipped: 0,
      },
      cappedGroups: 0,
    };
  }

  private processKey(
    run: RunState,
    suidKey: string,
    dbRecList: Record<string, unknown>[]
  ): void {
    const { params } = run;
    const fileCount = params.dbfReader
      ? (params.binaryFileSuidMap.get(suidKey) || []).length
      : (params.objectFileSuidMap.get(suidKey) || []).length;

    if (dbRecList.length === 1 && fileCount <= 1) {
      this.processSingleRow(run, suidKey, dbRecList[0], fileCount);
    } else {
      this.processCollisionGroup(run, suidKey, dbRecList);
    }
  }

  private rawDbSuid(run: RunState, dbRecord: Record<string, unknown>, suidKey: string): string {
    return this.suidResolver.buildCompositeRawSuid(dbRecord, run.params.dbSuidCols) || suidKey;
  }

  private processSingleRow(
    run: RunState,
    suidKey: string,
    dbRecord: Record<string, unknown>,
    fileCount: number
  ): void {
    const rawSuid = this.rawDbSuid(run, dbRecord, suidKey);
    if (fileCount === 0) {
      run.counts.onlyInDbCount++;
      run.items.push(buildOnlyInDbItem(`db-${suidKey}-0`, rawSuid));
      return;
    }
    this.comparePair(run, { suidKey, dbRecord, dbIndex: 0, rawSuid });
  }

  private comparePair(run: RunState, request: PairRequest): void {
    const { params } = run;
    const { suidKey, dbRecord, dbIndex, rawSuid, fileRow, pairing } = request;
    const binaryFileIndices = fileRow ? [] : params.binaryFileSuidMap.get(suidKey) || [];
    const objectFileRecList = fileRow ? [] : params.objectFileSuidMap.get(suidKey) || [];

    const { differences, fileFeatureRecord, fileGeometry, fileRecordIndex } =
      this.attributeExtractor.extractFeatureAttributesAndGeometry({
        dbRecord,
        dbIndex,
        fieldsToCompare: params.fieldsToCompare,
        fieldToFileKey: params.fieldToFileKey,
        binaryFileIndices,
        objectFileRecList,
        objectFileGeoms: objectFileRecList.map((record) => record._geometry),
        dbfReader: params.dbfReader,
        shpReader: params.shpReader,
        transformCoordinate: params.transformCoordinate,
        dbfCompareFields: params.dbfCompareFields,
        ignoreEncodingArtifacts: params.mappingConfig.ignoreEncodingArtifacts,
        fileIndexOverride: fileRow?.recordIndex,
        objectFileRecordOverride: fileRow && !params.dbfReader ? fileRow.record : undefined,
      });

    const geometryResult = this.geometryEvaluator.evaluateGeometryDifference(
      dbRecord,
      fileFeatureRecord || undefined,
      fileGeometry,
      params.mappingConfig
    );

    if (geometryResult.isGeometryDifferent) {
      run.counts.geometryMismatchCount++;
    } else if (differences.length > 0) {
      run.counts.attributeMismatchCount++;
    } else {
      run.counts.exactMatchesCount++;
      return;
    }

    run.items.push(
      buildPairedItem({
        id: `match-${suidKey}-${dbIndex}`,
        suid: rawSuid,
        dbRecord,
        differences,
        isGeometryDifferent: geometryResult.isGeometryDifferent,
        geometryDiffDetails: geometryResult.geometryDiffDetails,
        resolvedDbGeom: geometryResult.resolvedDbGeom,
        resolvedFileGeom: geometryResult.resolvedFileGeom,
        fileFeatureRecord:
          fileFeatureRecord ||
          (params.dbfReader && fileRecordIndex !== undefined
            ? params.dbfReader.readRecord(fileRecordIndex) || undefined
            : undefined),
        fileGeometry,
        fileRecordIndex,
        pairing,
      })
    );
  }

  private processCollisionGroup(
    run: RunState,
    suidKey: string,
    dbRecList: Record<string, unknown>[]
  ): void {
    const fileRows = this.loadFileRows(run.params, suidKey);
    const group: GroupContext = { suidKey, dbRecList, fileRows };
    const result = pairKeyGroup(
      dbRecList.map((record, index) => this.toDbPairingRow(run, record, index)),
      fileRows.map((fileRow) => this.toFilePairingRow(run, fileRow)),
      {
        areEquivalent: (dbValue, fileValue) =>
          this.suidResolver.areValuesEquivalent(dbValue, fileValue, {
            ignoreEncodingArtifacts: run.params.mappingConfig.ignoreEncodingArtifacts ?? true,
          }),
        maxCandidates: MAX_PAIRING_CANDIDATES,
      }
    );
    if (result.cappedSkipped) run.cappedGroups++;
    this.applyPairs(run, group, result.pairs);
    this.applyDbOutcomes(run, group, result);
    this.applyFileOutcomes(run, group, result);
  }

  private loadFileRows(params: CompareMatchedRecordsParams, suidKey: string): FileRow[] {
    const { dbfReader, shpReader, transformCoordinate } = params;
    if (dbfReader) {
      return (params.binaryFileSuidMap.get(suidKey) || []).map((recordIndex, ordinal) => ({
        ordinal,
        record: dbfReader.readRecord(recordIndex) || {},
        geometry: shpReader ? shpReader.readGeometry(recordIndex, transformCoordinate) : undefined,
        recordIndex,
      }));
    }
    return (params.objectFileSuidMap.get(suidKey) || []).map((record, ordinal) => ({
      ordinal,
      record,
      geometry: record._geometry,
    }));
  }

  private toDbPairingRow(
    run: RunState,
    record: Record<string, unknown>,
    index: number
  ): PairingRow {
    const { params } = run;
    const geometry = this.geometryEvaluator.resolveDbGeometry(record, params.mappingConfig);
    const columns = [...params.dbSuidCols, ...params.fieldsToCompare];
    return {
      index,
      geometry,
      signature: buildContentSignature(
        record,
        columns,
        geometry,
        this.signatureOptions(run, params.dbSuidCols)
      ),
      attributeSignature: buildContentSignature(
        record,
        columns,
        undefined,
        this.signatureOptions(run, params.dbSuidCols, attributeOnlyFingerprint)
      ),
      values: params.fieldsToCompare.map((field) =>
        record[field] !== undefined ? record[field] : null
      ),
    };
  }

  private toFilePairingRow(run: RunState, fileRow: FileRow): PairingRow {
    const { params } = run;
    const fileSuidCols = this.fileSuidCols(params);
    const fileKeys = params.fieldsToCompare.map(
      (field) => params.fieldToFileKey.get(field) || field
    );
    const geometry = this.geometryEvaluator.resolveFileGeometry(
      fileRow.record,
      fileRow.geometry,
      params.mappingConfig
    );
    return {
      index: fileRow.ordinal,
      geometry,
      signature: buildContentSignature(
        fileRow.record,
        [...fileSuidCols, ...fileKeys],
        geometry,
        this.signatureOptions(run, fileSuidCols)
      ),
      attributeSignature: buildContentSignature(
        fileRow.record,
        [...fileSuidCols, ...fileKeys],
        undefined,
        this.signatureOptions(run, fileSuidCols, attributeOnlyFingerprint)
      ),
      values: fileKeys.map((fileKey) => readFileValue(fileRow.record, fileKey)),
    };
  }

  private fileSuidCols(params: CompareMatchedRecordsParams): string[] {
    return params.targetFileSuidCols && params.targetFileSuidCols.length > 0
      ? params.targetFileSuidCols
      : params.dbSuidCols;
  }

  private signatureOptions(
    run: RunState,
    suidColumns: string[],
    fingerprintGeometry: (geometry: unknown) => string = fingerprintRoundedGeometry
  ): ContentSignatureOptions {
    return {
      suidColumns,
      cleanSuidPart: (value) => this.suidResolver.cleanKeyPart(value, run.keyOptions),
      fingerprintGeometry,
    };
  }

  private applyPairs(run: RunState, group: GroupContext, pairs: PairedRows[]): void {
    for (const pair of pairs) {
      const dbRecord = group.dbRecList[pair.dbIndex];
      const pairing: ItemPairing = {
        method: pair.method,
        dbCount: group.dbRecList.length,
        fileCount: group.fileRows.length,
        ...(pair.distance !== undefined ? { distance: pair.distance } : {}),
      };
      this.comparePair(run, {
        suidKey: group.suidKey,
        dbRecord,
        dbIndex: pair.dbIndex,
        rawSuid: this.rawDbSuid(run, dbRecord, group.suidKey),
        fileRow: group.fileRows[pair.fileIndex],
        pairing,
      });
    }
  }

  private ambiguousPairing(
    result: KeyGroupPairingResult,
    group: GroupContext
  ): { pairing: ItemPairing; note: string } {
    const dbCount = group.dbRecList.length;
    const fileCount = group.fileRows.length;
    if (result.cappedSkipped) {
      return {
        pairing: { method: PairingMethod.SKIPPED_CAP, dbCount, fileCount },
        note: `Grupo demasiado grande para emparejar (${dbCount} en DB / ${fileCount} en Archivo)`,
      };
    }
    return {
      pairing: { method: PairingMethod.NO_GEOMETRY, dbCount, fileCount },
      note: duplicateNote(dbCount, fileCount, "no se puede emparejar sin geometría en ambos lados"),
    };
  }

  private applyDbOutcomes(
    run: RunState,
    group: GroupContext,
    result: KeyGroupPairingResult
  ): void {
    const { suidKey, dbRecList } = group;
    const dbCount = dbRecList.length;
    const fileCount = group.fileRows.length;
    const dbItemId = (dbIndex: number) => `db-${suidKey}-${dbIndex}`;
    const rawSuid = (dbIndex: number) => this.rawDbSuid(run, dbRecList[dbIndex], suidKey);

    for (const dbIndex of result.dbTwinExtras) {
      run.counts.duplicateSuidCount++;
      run.items.push(
        buildDuplicateDbItem(
          { id: dbItemId(dbIndex), suid: rawSuid(dbIndex), dbCount, fileCount },
          dbRecList[dbIndex]
        )
      );
    }
    for (const dbIndex of result.unpairedDb) {
      run.counts.onlyInDbCount++;
      run.items.push(
        buildOnlyInDbItem(
          dbItemId(dbIndex),
          rawSuid(dbIndex),
          dbCount > 1 ? repeatedKeyNote(dbCount, fileCount) : undefined
        )
      );
    }
    const { pairing, note } = this.ambiguousPairing(result, group);
    for (const dbIndex of result.ambiguousDb) {
      run.counts.duplicateSuidCount++;
      run.items.push(
        buildDuplicateDbItem(
          { id: dbItemId(dbIndex), suid: rawSuid(dbIndex), dbCount, fileCount, note, pairing },
          dbRecList[dbIndex]
        )
      );
    }
  }

  private applyFileOutcomes(
    run: RunState,
    group: GroupContext,
    result: KeyGroupPairingResult
  ): void {
    const { suidKey, fileRows } = group;
    const dbCount = group.dbRecList.length;
    const fileCount = fileRows.length;
    const fileSuidCols = this.fileSuidCols(run.params);
    const rawSuid = (fileRow: FileRow) =>
      this.suidResolver.buildCompositeRawSuid(fileRow.record, fileSuidCols) || suidKey;

    run.counts.duplicateFileRowsSkipped += result.fileTwinExtras.length;
    for (const ordinal of result.unpairedFile) {
      const fileRow = fileRows[ordinal];
      run.counts.onlyInFileCount++;
      run.fileItems.push(
        buildOnlyInFileItem({
          id: `file-${suidKey}-${ordinal}`,
          suid: rawSuid(fileRow),
          record: fileRow.record,
          geometry: fileRow.geometry,
          recordIndex: fileRow.recordIndex,
        })
      );
    }
    const { pairing, note } = this.ambiguousPairing(result, group);
    for (const ordinal of result.ambiguousFile) {
      const fileRow = fileRows[ordinal];
      run.counts.duplicateSuidFileCount++;
      run.items.push(
        buildDuplicateFileItem(
          {
            id: `filedup:${suidKey}:${ordinal}`,
            suid: rawSuid(fileRow),
            dbCount,
            fileCount,
            note,
            pairing,
          },
          fileRow
        )
      );
    }
  }
}
