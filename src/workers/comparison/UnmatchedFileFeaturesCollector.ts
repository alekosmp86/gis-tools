import type { DiscrepancyItem } from "@/types/comparison";
import { DiscrepancyType } from "@/types/comparison";
import type { BinaryDbfReader } from "@/utils/binary/BinaryDbfReader";
import type { BinaryShpReader } from "@/utils/binary/BinaryShpReader";
import type { SuidKeyResolver } from "./SuidKeyResolver";

export interface CollectUnmatchedParams {
  processedSuids: Set<string>;
  binaryFileSuidMap: Map<string, number[]>;
  objectFileSuidMap: Map<string, Record<string, unknown>[]>;
  targetFileSuidCols: string[];
  dbfReader: BinaryDbfReader | null;
  shpReader: BinaryShpReader | null;
  transformCoordinate: ((coordinate: [number, number]) => [number, number]) | null;
}

/**
 * UnmatchedFileFeaturesCollector.ts
 * Collects features existing exclusively in the file dataset (Pass 2 of comparison),
 * creating ONLY_IN_SHP discrepancy items.
 */
export class UnmatchedFileFeaturesCollector {
  private readonly suidResolver: SuidKeyResolver;

  constructor(suidResolver: SuidKeyResolver) {
    this.suidResolver = suidResolver;
  }

  public collectUnmatchedFileFeatures(params: CollectUnmatchedParams): DiscrepancyItem[] {
    const {
      processedSuids,
      binaryFileSuidMap,
      objectFileSuidMap,
      targetFileSuidCols,
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

            unmatchedItems.push({
              id: `file-${suidKey}-${occurrenceIndex}`,
              suid: rawSuid,
              type: DiscrepancyType.ONLY_IN_SHP,
              differences: [],
              shpFeatureProps: fileRec,
              shpGeometry: fileGeom || undefined,
              fileRecordIndex: recordIndex,
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

            unmatchedItems.push({
              id: `file-${suidKey}-${featureIndex}`,
              suid: rawSuid,
              type: DiscrepancyType.ONLY_IN_SHP,
              differences: [],
              shpFeatureProps: fileRec,
              shpGeometry: fileGeomList[featureIndex] ?? fileGeomList[0],
            });
          });
        }
      });
    }

    return unmatchedItems;
  }
}
