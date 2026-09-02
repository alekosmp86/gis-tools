import type { ComparisonSourceDescriptor } from "@/types/comparison";
import { FileSourceKind } from "@/types/parsers";

export const DB_VS_SHAPEFILE_DESCRIPTOR: ComparisonSourceDescriptor = {
  targetLabel: "Base de Datos",
  targetShortLabel: "DB",
  targetIconKind: "database",
  sourceLabel: "Archivo Shapefile",
  sourceShortLabel: "SHP",
  sourceIconKind: "layers",
};

export const DB_VS_CSV_DESCRIPTOR: ComparisonSourceDescriptor = {
  targetLabel: "Base de Datos",
  targetShortLabel: "DB",
  targetIconKind: "database",
  sourceLabel: "Archivo CSV",
  sourceShortLabel: "CSV",
  sourceIconKind: "table",
};

export const DB_VS_DB_DESCRIPTOR: ComparisonSourceDescriptor = {
  targetLabel: "DB Destino",
  targetShortLabel: "DB Destino",
  targetIconKind: "database",
  sourceLabel: "DB Origen",
  sourceShortLabel: "DB Origen",
  sourceIconKind: "database",
};

/**
 * Resolves or falls back to an appropriate ComparisonSourceDescriptor
 * based on provided dataset metadata or source database config.
 */
export function resolveComparisonDescriptor(params: {
  descriptor?: ComparisonSourceDescriptor;
  isDbToDb?: boolean;
  fileSourceKind?: FileSourceKind;
}): ComparisonSourceDescriptor {
  if (params.descriptor) {
    return params.descriptor;
  }

  if (params.isDbToDb) {
    return DB_VS_DB_DESCRIPTOR;
  }

  if (params.fileSourceKind === FileSourceKind.CSV) {
    return DB_VS_CSV_DESCRIPTOR;
  }

  return DB_VS_SHAPEFILE_DESCRIPTOR;
}
