import type { DbConfig } from "@/types/db";
import type { ParsedFileDataset } from "@/types/parsers";
import type { ProgressCallback } from "@/services/workerBridge";

export interface InsertFieldDefault {
  fieldName: string;
  value: string;
  useRawExpression: boolean;
}

export interface ColumnMappingConfig {
  suidColumns: string[];
  matchedFileSuidColumns: string[];
  fieldsToCompare: string[];
  attributeMap?: Record<string, string>;
  compareGeometry: boolean;
  targetSrid?: number;
  insertDefaults?: Record<string, InsertFieldDefault>;
}

export interface SuidMappingStepRef {
  proceed: () => void;
}

export const DiscrepancyType = {
  MATCH: "MATCH",
  ATTRIBUTE_MISMATCH: "ATTRIBUTE_MISMATCH",
  GEOMETRY_MISMATCH: "GEOMETRY_MISMATCH", // @planned — compareGeometry flag in ColumnMappingConfig
  ONLY_IN_DB: "ONLY_IN_DB",
  ONLY_IN_SHP: "ONLY_IN_SHP",
  NULL_SUID: "NULL_SUID",
  DUPLICATE_SUID: "DUPLICATE_SUID",
} as const;

export type DiscrepancyType = (typeof DiscrepancyType)[keyof typeof DiscrepancyType];

export const DiscrepancyFilter = {
  ALL: "ALL",
  ...DiscrepancyType,
} as const;

export type DiscrepancyFilter = (typeof DiscrepancyFilter)[keyof typeof DiscrepancyFilter];

export const ResultsViewTab = {
  TABLE: "table",
  MAP: "map",
  SQL: "sql",
} as const;

export type ResultsViewTab = (typeof ResultsViewTab)[keyof typeof ResultsViewTab];

export const SqlScriptType = {
  UPDATE: "UPDATE",
  INSERT: "INSERT",
} as const;

export type SqlScriptType = (typeof SqlScriptType)[keyof typeof SqlScriptType];

export interface AttributeDifference {
  fieldName: string;
  dbValue: string | number | null;
  shpValue: string | number | null;
}

export interface GeometryDifference {
  dbType?: string;
  fileType?: string;
  details: string;
  dbGeomRaw?: unknown;
  fileGeomRaw?: unknown;
}

export interface DiscrepancyItem {
  id: string;
  suid: string;
  type: DiscrepancyType;
  differences: AttributeDifference[];
  geometryDifference?: GeometryDifference;
  dbRecord?: Record<string, unknown>;
  shpFeatureProps?: Record<string, unknown>;
  shpGeometry?: unknown;
  note?: string;
  duplicateDetails?: {
    targetCount: number;
    sourceCount: number;
  };
}

export interface ComparisonSummary {
  totalDbRecords: number;
  totalFileRecords: number;
  totalAnalyzed: number;
  exactMatchesCount: number;
  attributeMismatchCount: number;
  geometryMismatchCount: number;
  onlyInDbCount: number;
  onlyInShpCount: number;
  nullSuidCount: number;
  duplicateSuidCount: number;
  items: DiscrepancyItem[];
  sqlUpdateScript: string;
  sqlInsertScript: string;
  sqlUpdateCount: number;
  sqlInsertCount: number;
  sqlUpdatePreview: string;
  sqlInsertPreview: string;
}

export interface IComparisonEngine {
  readonly engineName: string;
  compare(
    dbConfig: DbConfig,
    dataset: ParsedFileDataset,
    mappingConfig: ColumnMappingConfig,
    onProgress?: ProgressCallback
  ): Promise<ComparisonSummary>;
}

export interface ComparisonProgress {
  phase: string;
  current: number;
  total: number;
  pct: number;
}

export type ComparisonIconKind = "database" | "file" | "layers" | "table";

export interface ComparisonSourceDescriptor {
  /** Target dataset label (the dataset being synchronized/updated, e.g. "DB Destino", "Base de Datos") */
  targetLabel: string;
  targetShortLabel: string;
  targetIconKind: ComparisonIconKind;

  /** Source dataset label (the reference dataset, e.g. "DB Origen", "Archivo Shapefile", "Archivo CSV") */
  sourceLabel: string;
  sourceShortLabel: string;
  sourceIconKind: ComparisonIconKind;
}
