import type { SerializableFileDataset } from "@/types/workerMessages";
import type { BinaryDbfReader, DbfFieldDescriptor } from "@/utils/binary/BinaryDbfReader";
import { SuidKeyResolver } from "./SuidKeyResolver";

export interface BinaryIndexResult {
  readonly suidMap: Map<string, number[]>;
  readonly nullRecordIndices: number[];
  readonly totalRecords: number;
}

export interface ObjectIndexResult {
  readonly suidMap: Map<string, Record<string, unknown>[]>;
  readonly nullRecords: Record<string, unknown>[];
  readonly totalRecords: number;
}

/**
 * FileDatasetIndexer
 * Object-Oriented Indexer that builds high-speed SUID hash maps from binary DBF buffers or object datasets.
 */
export class FileDatasetIndexer {
  private readonly suidResolver: SuidKeyResolver;

  constructor(suidResolver?: SuidKeyResolver) {
    this.suidResolver = suidResolver ?? new SuidKeyResolver();
  }

  public indexBinaryDbf(
    dbfReader: BinaryDbfReader,
    targetFileSuidCols: string[]
  ): BinaryIndexResult {
    const suidMap = new Map<string, number[]>();
    const nullRecordIndices: number[] = [];
    const totalRecords = dbfReader.header.recordCount;

    const suidFieldDescriptors: (DbfFieldDescriptor | undefined)[] = targetFileSuidCols.map(
      (colName) =>
        dbfReader.header.fields.find(
          (field) => field.name.toLowerCase() === colName.toLowerCase()
        )
    );

    for (let recordIndex = 0; recordIndex < totalRecords; recordIndex++) {
      let isRecordValid = true;
      const keyParts: string[] = [];

      for (let fieldIndex = 0; fieldIndex < suidFieldDescriptors.length; fieldIndex++) {
        const descriptor = suidFieldDescriptors[fieldIndex];
        if (!descriptor) {
          isRecordValid = false;
          break;
        }

        const rawFieldValue = dbfReader.readFieldValue(recordIndex, descriptor);
        const cleanedKey = this.suidResolver.cleanKeyString(rawFieldValue);

        if (cleanedKey === "") {
          isRecordValid = false;
          break;
        }
        keyParts.push(cleanedKey);
      }

      if (!isRecordValid || keyParts.length === 0) {
        nullRecordIndices.push(recordIndex);
        continue;
      }

      const compositeKey = keyParts.join("|");
      const existingIndices = suidMap.get(compositeKey);
      if (existingIndices) {
        existingIndices.push(recordIndex);
      } else {
        suidMap.set(compositeKey, [recordIndex]);
      }
    }

    return { suidMap, nullRecordIndices, totalRecords };
  }

  public indexObjectDataset(
    fileDataset: SerializableFileDataset,
    targetFileSuidCols: string[]
  ): ObjectIndexResult {
    const suidMap = new Map<string, Record<string, unknown>[]>();
    const nullRecords: Record<string, unknown>[] = [];
    const recordsObject = fileDataset.recordsObject || {};
    const objectValues = Object.values(recordsObject);
    const geojsonObj = fileDataset.geojson as { features?: Array<{ properties?: Record<string, unknown>; geometry?: unknown }> } | undefined;
    const geojsonFeatures = geojsonObj?.features || [];
    const totalRecords = Math.max(objectValues.length, geojsonFeatures.length, fileDataset.featureCount);

    for (let index = 0; index < totalRecords; index++) {
      const record = objectValues[index] || geojsonFeatures[index]?.properties || {};
      const featureGeom = geojsonFeatures[index]?.geometry || record._geometry || record.geometry;

      const fullRecord = {
        ...record,
        _geometry: featureGeom,
      };

      const compositeKey = this.suidResolver.buildCompositeKey(fullRecord, targetFileSuidCols);

      if (!compositeKey) {
        nullRecords.push(fullRecord);
        continue;
      }

      const existingRecords = suidMap.get(compositeKey);
      if (existingRecords) {
        existingRecords.push(fullRecord);
      } else {
        suidMap.set(compositeKey, [fullRecord]);
      }
    }

    return { suidMap, nullRecords, totalRecords };
  }
}
