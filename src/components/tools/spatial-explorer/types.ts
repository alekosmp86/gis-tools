import type { ParsedFileDataset } from "@/core/types/parsers";
import type { DbConfig } from "@/core/types/db";

export type SpatialSourceType = "file" | "db";

export interface FileSourceMeta {
  type: "file";
  fileName: string;
  fileSize: number;
  featureCount: number;
  attributes: string[];
  geometryType?: string;
  isLargeDataset?: boolean;
}

export interface DbSourceMeta {
  type: "db";
  config: DbConfig;
  totalRows: number;
  columnsCount: number;
  columns: string[];
  geometryType?: string | null;
  detectedSrid?: number | null;
  loadedRows?: number;
}

export type SourceMeta = FileSourceMeta | DbSourceMeta;

export interface DataSourceAdapter {
  id: SpatialSourceType;
  label: string;
}

export interface FileReadyPayload {
  dataset: ParsedFileDataset;
}

export interface DbReadyPayload {
  config: DbConfig;
  columns: string[];
  totalRows: number;
}
