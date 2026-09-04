import type { AttributeDifference } from "@/types/comparison";
import type { BinaryDbfReader, DbfFieldDescriptor } from "@/utils/binary/BinaryDbfReader";
import type { BinaryShpReader } from "@/utils/binary/BinaryShpReader";
import type { Geometry } from "geojson";
import type { SuidKeyResolver } from "./SuidKeyResolver";

export interface ExtractFeatureParams {
  dbRecord: Record<string, unknown>;
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
}

export interface ExtractedFeatureResult {
  differences: AttributeDifference[];
  fileFeatureRecord: Record<string, unknown> | null;
  fileGeometry: Geometry | unknown | null;
  fileRecordIndex: number | undefined;
}

/**
 * FeatureAttributeExtractor.ts
 * Reads attribute values and geometry from binary DBF buffers or plain JS objects,
 * comparing field values against database records.
 */
export class FeatureAttributeExtractor {
  private readonly suidResolver: SuidKeyResolver;

  constructor(suidResolver: SuidKeyResolver) {
    this.suidResolver = suidResolver;
  }

  public extractFeatureAttributesAndGeometry(
    params: ExtractFeatureParams
  ): ExtractedFeatureResult {
    const {
      dbRecord,
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
    let fileRecordIndex: number | undefined;

    if (dbfReader) {
      const targetRecordIndex = binaryFileIndices[dbIndex] ?? binaryFileIndices[0];
      fileRecordIndex = targetRecordIndex;

      fieldsToCompare.forEach((field) => {
        const dbVal = dbRecord[field] !== undefined ? dbRecord[field] : null;
        const fieldDescriptor = dbfCompareFields.get(field);

        if (fieldDescriptor) {
          const fileVal = dbfReader.readFieldValue(targetRecordIndex, fieldDescriptor);
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
        fileGeometry = shpReader.readGeometry(targetRecordIndex, transformCoordinate);
      }
    } else {
      const objectFileRec = objectFileRecList[dbIndex] ?? objectFileRecList[0];
      fileFeatureRecord = objectFileRec;
      fileGeometry = objectFileGeoms[dbIndex] ?? objectFileGeoms[0];

      fieldsToCompare.forEach((field) => {
        const dbVal = dbRecord[field] !== undefined ? dbRecord[field] : null;
        const fileKey = fieldToFileKey.get(field) || field;
        let fileVal: unknown = null;

        if (fileKey != null) {
          if (objectFileRec[fileKey] !== undefined) {
            fileVal = objectFileRec[fileKey];
          } else {
            const lowerKey = fileKey.toLowerCase();
            for (const [key, value] of Object.entries(objectFileRec)) {
              if (key.toLowerCase() === lowerKey) {
                fileVal = value;
                break;
              }
            }
          }
        }

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

    return { differences, fileFeatureRecord, fileGeometry, fileRecordIndex };
  }
}
