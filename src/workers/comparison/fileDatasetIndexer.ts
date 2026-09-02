/**
 * fileDatasetIndexer.ts
 * Indexación en memoria de registros de Shapefile/DBF (vía buffers binarios) o GeoJSON/Objetos.
 */

import type { SerializableFileDataset } from "@/types/workerMessages";
import type { BinaryDbfReader, DbfFieldDescriptor } from "@/utils/binary/BinaryDbfReader";
import { cleanSuid, buildCompositeKeyFromRecord } from "./suidKeyUtils";

export interface BinaryIndexResult {
  binaryFileSuidMap: Map<string, number[]>;
  binaryFileNullIndices: number[];
  dbfSuidFields: DbfFieldDescriptor[];
  totalFileRecords: number;
}

export interface ObjectIndexResult {
  objectFileSuidMap: Map<string, Array<Record<string, unknown>>>;
  objectFileGeomMap: Map<string, unknown[]>;
  objectFileNullRecords: Array<Record<string, unknown>>;
  totalFileRecords: number;
}

export function indexBinaryDbfDataset(
  dbfReader: BinaryDbfReader,
  targetFileSuidCols: string[],
  onProgress?: (phase: string, current: number, total: number) => void
): BinaryIndexResult {
  const totalFileRecords = dbfReader.header.recordCount;
  const binaryFileSuidMap = new Map<string, number[]>();
  const binaryFileNullIndices: number[] = [];

  const availableDbfFields = dbfReader.header.fields;
  const dbfSuidFields: DbfFieldDescriptor[] = targetFileSuidCols.map((colName) => {
    const match = availableDbfFields.find(
      (field) =>
        field.name.toLowerCase() === colName.toLowerCase() ||
        field.name.toLowerCase() === colName.toLowerCase().slice(0, 10)
    );
    return (
      match || {
        name: colName,
        dataType: "C",
        length: 10,
        decimalCount: 0,
        byteOffsetInRecord: 0,
      }
    );
  });

  for (let recordIndex = 0; recordIndex < totalFileRecords; recordIndex++) {
    const suidValues = dbfSuidFields.map((fieldDescriptor) =>
      cleanSuid(dbfReader.readFieldValue(recordIndex, fieldDescriptor))
    );
    const isNullKey =
      dbfSuidFields.length === 1
        ? !suidValues[0]
        : suidValues.every((value) => !value);

    if (isNullKey) {
      binaryFileNullIndices.push(recordIndex);
    } else {
      const compositeKey = suidValues.join("_");
      const existingIndices = binaryFileSuidMap.get(compositeKey) ?? [];
      existingIndices.push(recordIndex);
      binaryFileSuidMap.set(compositeKey, existingIndices);
    }

    if (onProgress && recordIndex % 10_000 === 0) {
      onProgress("Indexando archivo fuente (modo binario)", recordIndex, totalFileRecords);
    }
  }

  if (onProgress) {
    onProgress("Indexando archivo fuente (modo binario)", totalFileRecords, totalFileRecords);
  }

  return {
    binaryFileSuidMap,
    binaryFileNullIndices,
    dbfSuidFields,
    totalFileRecords,
  };
}

export function indexObjectDataset(
  fileDataset: SerializableFileDataset,
  targetFileSuidCols: string[],
  onProgress?: (phase: string, current: number, total: number) => void
): ObjectIndexResult {
  const objectFileSuidMap = new Map<string, Array<Record<string, unknown>>>();
  const objectFileGeomMap = new Map<string, unknown[]>();
  const objectFileNullRecords: Array<Record<string, unknown>> = [];

  const shpFeatures =
    (fileDataset.geojson as { features?: unknown[] } | undefined)?.features ?? [];

  const totalFileRecords =
    shpFeatures.length > 0
      ? shpFeatures.length
      : fileDataset.recordsObject
        ? Object.keys(fileDataset.recordsObject).length
        : 0;

  if (shpFeatures.length > 0) {
    (shpFeatures as Array<{ properties: Record<string, unknown>; geometry: unknown }>).forEach(
      (feature, featureIndex) => {
        if (feature.properties) {
          const key = buildCompositeKeyFromRecord(feature.properties, targetFileSuidCols);
          if (!key) {
            objectFileNullRecords.push(feature.properties);
          } else {
            const recordList = objectFileSuidMap.get(key) ?? [];
            recordList.push(feature.properties);
            objectFileSuidMap.set(key, recordList);

            const geomList = objectFileGeomMap.get(key) ?? [];
            geomList.push(feature.geometry);
            objectFileGeomMap.set(key, geomList);
          }
        }
        if (onProgress && featureIndex % 5_000 === 0) {
          onProgress("Indexando archivo fuente", featureIndex, totalFileRecords);
        }
      }
    );
  } else if (fileDataset.recordsObject) {
    Object.values(fileDataset.recordsObject).forEach((record, recordIndex) => {
      const key = buildCompositeKeyFromRecord(record, targetFileSuidCols);
      if (!key) {
        objectFileNullRecords.push(record);
      } else {
        const recordList = objectFileSuidMap.get(key) ?? [];
        recordList.push(record);
        objectFileSuidMap.set(key, recordList);
      }
      if (onProgress && recordIndex % 5_000 === 0) {
        onProgress("Indexando archivo fuente", recordIndex, totalFileRecords);
      }
    });
  }

  if (onProgress) {
    onProgress("Indexando archivo fuente", totalFileRecords, totalFileRecords);
  }

  return {
    objectFileSuidMap,
    objectFileGeomMap,
    objectFileNullRecords,
    totalFileRecords,
  };
}
