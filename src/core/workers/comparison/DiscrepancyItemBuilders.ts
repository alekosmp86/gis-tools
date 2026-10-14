import {
  DiscrepancyType,
  type AttributeDifference,
  type DiscrepancyItem,
  type ItemPairing,
} from "@/core/types/comparison";

export interface PairedItemInput {
  id: string;
  suid: string;
  dbRecord: Record<string, unknown>;
  differences: AttributeDifference[];
  isGeometryDifferent: boolean;
  geometryDiffDetails?: string;
  resolvedDbGeom: unknown;
  resolvedFileGeom: unknown;
  fileFeatureRecord?: Record<string, unknown>;
  fileGeometry: unknown;
  fileRecordIndex?: number;
  pairing?: ItemPairing;
}

export interface FileItemInput {
  id: string;
  suid: string;
  record: Record<string, unknown>;
  geometry: unknown;
  recordIndex?: number;
}

export interface DuplicateItemInput {
  id: string;
  suid: string;
  dbCount: number;
  fileCount: number;
  note?: string;
  pairing?: ItemPairing;
}

export function duplicateNote(dbCount: number, fileCount: number, suffix?: string): string {
  const base = `SUID Duplicado (${dbCount} en DB / ${fileCount} en Archivo)`;
  return suffix ? `${base}: ${suffix}` : base;
}

export function buildPairedItem(input: PairedItemInput): DiscrepancyItem {
  const type = input.isGeometryDifferent
    ? DiscrepancyType.GEOMETRY_MISMATCH
    : DiscrepancyType.ATTRIBUTE_MISMATCH;
  const { dbRecord } = input;
  return {
    id: input.id,
    suid: input.suid,
    type,
    differences: input.differences,
    geometryDifference: input.isGeometryDifferent
      ? {
          details: input.geometryDiffDetails || "Geometría espacial no coincide",
          dbGeomRaw: input.resolvedDbGeom || dbRecord.geom_wkb || dbRecord.geom || dbRecord.geometry,
          fileGeomRaw: input.resolvedFileGeom || input.fileGeometry,
        }
      : undefined,
    dbRecord,
    shpFeatureProps: input.fileFeatureRecord,
    shpGeometry: input.resolvedFileGeom || input.fileGeometry || undefined,
    fileRecordIndex: input.fileRecordIndex,
    duplicateDetails: undefined,
    note: undefined,
    ...(input.pairing ? { pairing: input.pairing } : {}),
  };
}

export function repeatedKeyNote(dbCount: number, fileCount: number): string {
  return `Clave repetida en DB (${dbCount} en DB / ${fileCount} en Archivo)`;
}

export function buildOnlyInDbItem(id: string, suid: string, note?: string): DiscrepancyItem {
  return {
    id,
    suid,
    type: DiscrepancyType.ONLY_IN_DB,
    differences: [],
    duplicateDetails: undefined,
    note,
  };
}

export function buildDuplicateDbItem(
  input: DuplicateItemInput,
  dbRecord: Record<string, unknown>
): DiscrepancyItem {
  return {
    id: input.id,
    suid: input.suid,
    type: DiscrepancyType.DUPLICATE_SUID,
    differences: [],
    dbRecord,
    duplicateDetails: { targetCount: input.dbCount, sourceCount: input.fileCount },
    note: input.note ?? duplicateNote(input.dbCount, input.fileCount),
    ...(input.pairing ? { pairing: input.pairing } : {}),
  };
}

export function buildOnlyInFileItem(input: FileItemInput): DiscrepancyItem {
  return {
    id: input.id,
    suid: input.suid,
    type: DiscrepancyType.ONLY_IN_SHP,
    differences: [],
    shpFeatureProps: input.record,
    shpGeometry: input.geometry || undefined,
    fileRecordIndex: input.recordIndex,
  };
}

export function buildDuplicateFileItem(
  input: DuplicateItemInput,
  file: Omit<FileItemInput, "id" | "suid">
): DiscrepancyItem {
  return {
    id: input.id,
    suid: input.suid,
    type: DiscrepancyType.DUPLICATE_SUID,
    differences: [],
    shpFeatureProps: file.record,
    shpGeometry: file.geometry || undefined,
    fileRecordIndex: file.recordIndex,
    duplicateDetails: { targetCount: input.dbCount, sourceCount: input.fileCount },
    note: input.note ?? duplicateNote(input.dbCount, input.fileCount),
    ...(input.pairing ? { pairing: input.pairing } : {}),
  };
}
