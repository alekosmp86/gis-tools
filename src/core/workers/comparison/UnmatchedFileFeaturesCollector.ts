import type { DiscrepancyItem } from "@/core/types/comparison";
import { DiscrepancyType } from "@/core/types/comparison";
import type { BinaryDbfReader } from "@/core/binary/BinaryDbfReader";
import type { BinaryShpReader } from "@/core/binary/BinaryShpReader";
import type { SuidKeyOptions, SuidKeyResolver } from "./SuidKeyResolver";
import { buildContentSignature, type ContentSignatureOptions } from "./ContentSignature";

export interface CollectUnmatchedParams {
  processedSuids: Set<string>;
  binaryFileSuidMap: Map<string, number[]>;
  objectFileSuidMap: Map<string, Record<string, unknown>[]>;
  targetFileSuidCols: string[];
  signatureColumns?: string[];
  keyOptions?: SuidKeyOptions;
  dbfReader: BinaryDbfReader | null;
  shpReader: BinaryShpReader | null;
  transformCoordinate: ((coordinate: [number, number]) => [number, number]) | null;
}

export interface UnmatchedCollectionResult {
  insertItems: DiscrepancyItem[];
  duplicateItems: DiscrepancyItem[];
  duplicateFileRowsSkipped: number;
}

interface FileOccurrence {
  record: Record<string, unknown>;
  geometry: unknown;
  ownGeometry: unknown;
  recordIndex?: number;
}

/**
 * UnmatchedFileFeaturesCollector.ts
 * Collects features existing exclusively in the file dataset (Pass 2 of comparison).
 * Keys with a single occurrence become ONLY_IN_SHP. Keys repeated in the file collapse
 * exact-identical rows into one ONLY_IN_SHP; if the repeated rows differ in content the key is
 * ambiguous and every occurrence is reported as DUPLICATE_SUID (never inserted).
 */
export class UnmatchedFileFeaturesCollector {
  private readonly suidResolver: SuidKeyResolver;

  constructor(suidResolver: SuidKeyResolver) {
    this.suidResolver = suidResolver;
  }

  public collectUnmatchedFileFeatures(params: CollectUnmatchedParams): UnmatchedCollectionResult {
    const {
      processedSuids,
      binaryFileSuidMap,
      objectFileSuidMap,
      targetFileSuidCols,
      dbfReader,
      shpReader,
      transformCoordinate,
    } = params;
    const suidLower = new Set(targetFileSuidCols.map((name) => name.toLowerCase()));
    const compared = (params.signatureColumns ?? []).filter(
      (name) => !suidLower.has(name.toLowerCase())
    );
    const signatureColumns = Array.from(new Set([...targetFileSuidCols, ...compared]));
    const signatureOptions: ContentSignatureOptions = {
      suidColumns: targetFileSuidCols,
      cleanSuidPart: (value) => this.suidResolver.cleanKeyPart(value, params.keyOptions),
      allProperties: compared.length === 0,
    };

    const result: UnmatchedCollectionResult = {
      insertItems: [],
      duplicateItems: [],
      duplicateFileRowsSkipped: 0,
    };

    if (dbfReader) {
      binaryFileSuidMap.forEach((indices, suidKey) => {
        if (processedSuids.has(suidKey)) return;
        const occurrences: FileOccurrence[] = indices.map((recordIndex) => {
          const ownGeometry = shpReader ? shpReader.readGeometry(recordIndex, transformCoordinate) : undefined;
          return {
          record: dbfReader.readRecord(recordIndex) || {},
          geometry: ownGeometry,
          ownGeometry,
          recordIndex,
          };
        });
        this.classifyKey(suidKey, occurrences, targetFileSuidCols, signatureColumns, signatureOptions, result);
      });
    } else {
      objectFileSuidMap.forEach((recList, suidKey) => {
        if (processedSuids.has(suidKey)) return;
        const firstGeometry = recList[0]?._geometry;
        const occurrences: FileOccurrence[] = recList.map((record) => ({
          record,
          geometry: record._geometry ?? firstGeometry,
          ownGeometry: record._geometry,
        }));
        this.classifyKey(suidKey, occurrences, targetFileSuidCols, signatureColumns, signatureOptions, result);
      });
    }

    return result;
  }

  private classifyKey(
    suidKey: string,
    occurrences: FileOccurrence[],
    targetFileSuidCols: string[],
    signatureColumns: string[],
    signatureOptions: ContentSignatureOptions,
    result: UnmatchedCollectionResult
  ): void {
    const rawSuidOf = (occurrence: FileOccurrence) =>
      this.suidResolver.buildCompositeRawSuid(occurrence.record, targetFileSuidCols) || suidKey;

    if (occurrences.length > 1) {
      const signatures = new Set(
        occurrences.map((occurrence) => buildContentSignature(
          occurrence.record,
          signatureColumns,
          occurrence.ownGeometry,
          signatureOptions
        ))
      );
      if (signatures.size > 1) {
        occurrences.forEach((occurrence, occurrenceIndex) => {
          result.duplicateItems.push({
            id: `filedup:${suidKey}:${occurrenceIndex}`,
            suid: rawSuidOf(occurrence),
            type: DiscrepancyType.DUPLICATE_SUID,
            differences: [],
            shpFeatureProps: occurrence.record,
            shpGeometry: occurrence.geometry || undefined,
            fileRecordIndex: occurrence.recordIndex,
            duplicateDetails: { targetCount: 0, sourceCount: occurrences.length },
            note: `SUID Duplicado (0 en DB / ${occurrences.length} en Archivo)`,
          });
        });
        return;
      }
      result.duplicateFileRowsSkipped += occurrences.length - 1;
    }

    const first = occurrences[0];
    result.insertItems.push({
      id: `file-${suidKey}-0`,
      suid: rawSuidOf(first),
      type: DiscrepancyType.ONLY_IN_SHP,
      differences: [],
      shpFeatureProps: first.record,
      shpGeometry: first.geometry || undefined,
      fileRecordIndex: first.recordIndex,
    });
  }
}
