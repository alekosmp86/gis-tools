import type { DbConfig } from "@/types/db";
import type { ColumnMappingConfig } from "@/types/gis";
import type { ParsedFileDataset } from "@/types/parsers";
import type { ProgressCallback } from "@/services/workerBridge";

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

export interface DiscrepancyItem {
  id: string;
  suid: string;
  type: DiscrepancyType;
  differences: AttributeDifference[];
  dbRecord?: Record<string, unknown>;
  shpFeatureProps?: Record<string, unknown>;
  shpGeometry?: unknown;
  note?: string;
}

export interface ComparisonSummary {
  totalDbRecords: number;
  totalFileRecords: number;
  totalAnalyzed: number;
  exactMatchesCount: number;
  attributeMismatchCount: number;
  geometryMismatchCount: number; // @planned — always 0 until geometry comparison is implemented
  onlyInDbCount: number;
  onlyInShpCount: number;
  nullSuidCount: number;
  duplicateSuidCount: number;
  items: DiscrepancyItem[];
  /** UPDATE statements for attribute mismatches (records exist in both but differ) */
  sqlUpdateScript: string;
  /** INSERT statements for records present only in the file source (missing from DB) */
  sqlInsertScript: string;
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

export interface DiscrepanciesSummaryBarProps {
  summary: ComparisonSummary;
  activeFilter: DiscrepancyFilter;
  onSelectFilter: (filter: DiscrepancyFilter) => void;
}

export interface DiscrepanciesTableProps {
  items: DiscrepancyItem[];
  activeFilter: DiscrepancyFilter;
  searchQuery: string;
}

export interface SqlPatchDrawerProps {
  sqlUpdateScript: string;
  sqlInsertScript: string;
  tableName: string;
  dbConfig: DbConfig;
}
