import type { Geometry } from "geojson";
import { extractShapefileZip } from "@/core/binary/ZipShapefileExtractor";
import { BinaryDbfReader } from "@/core/binary/BinaryDbfReader";
import { BinaryShpReader } from "@/core/binary/BinaryShpReader";

export { SHP_GEOMETRY_SOURCE } from "@/core/types/shpReplace";

const DEFAULT_DBF_ENCODING = "windows-1252";

export interface ShpRecordRow {
  readonly rec: number;
  readonly values: Record<string, string | null>;
  readonly geometryJson: string | null;
}

export interface OpenShapefile {
  readonly fieldNames: string[];
  readonly recordCount: number;
  readonly shapeRecordCount: number;
  readonly prjText: string | null;
  records(): Generator<ShpRecordRow, void, undefined>;
}

const stringifyDbfValue = (value: unknown): string | null => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
};

const stringifyRecordValues = (record: Record<string, unknown>): Record<string, string | null> =>
  Object.fromEntries(Object.entries(record).map(([name, value]) => [name, stringifyDbfValue(value)]));

const stringifyGeometry = (geometry: Geometry | null): string | null =>
  geometry ? JSON.stringify(geometry) : null;

function toShpRecordRow(
  recordIndex: number,
  dbfReader: BinaryDbfReader,
  shpReader: BinaryShpReader
): ShpRecordRow {
  return {
    rec: recordIndex + 1,
    values: stringifyRecordValues(dbfReader.readRecord(recordIndex) ?? {}),
    geometryJson: stringifyGeometry(shpReader.readGeometry(recordIndex)),
  };
}

function* iterateShpRecordRows(
  dbfReader: BinaryDbfReader,
  shpReader: BinaryShpReader
): Generator<ShpRecordRow, void, undefined> {
  const recordCount = dbfReader.header.recordCount;
  for (let recordIndex = 0; recordIndex < recordCount; recordIndex++) {
    if (dbfReader.isDeleted(recordIndex)) continue;
    yield toShpRecordRow(recordIndex, dbfReader, shpReader);
  }
}

export async function openShapefileZip(zip: ArrayBuffer | Uint8Array): Promise<OpenShapefile> {
  const extractedPackage = await extractShapefileZip(zip);
  if (!extractedPackage.shpBuffer) {
    throw new Error("No se encontró el archivo .shp dentro del ZIP.");
  }
  if (!extractedPackage.dbfBuffer) {
    throw new Error("No se encontró el archivo .dbf dentro del ZIP.");
  }

  const dbfReader = new BinaryDbfReader(
    extractedPackage.dbfBuffer,
    extractedPackage.cpgText || DEFAULT_DBF_ENCODING
  );
  if (dbfReader.header.recordCount === 0) {
    throw new Error("El archivo no contiene registros.");
  }
  const shpReader = new BinaryShpReader(extractedPackage.shpBuffer);

  return {
    fieldNames: dbfReader.header.fields.map((field) => field.name),
    recordCount: dbfReader.header.recordCount,
    shapeRecordCount: shpReader.recordCount,
    prjText: extractedPackage.prjText ?? null,
    records: () => iterateShpRecordRows(dbfReader, shpReader),
  };
}
