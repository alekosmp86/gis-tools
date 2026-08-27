import type { DbConfig, DbColumnMetadata } from "@/types/db";
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
  insertDefaults?: Record<string, InsertFieldDefault>;
}

export interface SuidMappingStepRef {
  proceed: () => void;
}

export interface SuidMappingStepProps {
  dbColumns: string[];
  columnDetails?: DbColumnMetadata[];
  fileAttributes: string[];
  onSuccess: (mappingConfig: ColumnMappingConfig) => void;
  onBack: () => void;
  initialConfig?: ColumnMappingConfig | null;
  showGeometryToggle?: boolean;
  onReadyChange?: (ready: boolean) => void;
}

export interface SuidSelectorCardProps {
  selectableColumns: string[];
  selectedSuids: string[];
  matchedFileSuids: string[];
  onToggleSuid: (suid: string) => void;
}

export interface AttributeFieldsCardProps {
  availableFields: string[];
  selectedFields: string[];
  attributeMap: Record<string, string>;
  fileAttributes: string[];
  onToggleField: (field: string) => void;
  onMapField: (dbCol: string, fileAttr: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

export interface GeometryToggleCardProps {
  compareGeometry: boolean;
  onToggleGeometry: (enabled: boolean) => void;
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

export interface ComparisonProgress {
  phase: string;
  current: number;
  total: number;
  pct: number;
}

export interface ResyncBannerProps {
  isReanalyzing: boolean;
  progress: ComparisonProgress;
  customMessage?: string;
}

export interface DiscrepanciesSummaryBarProps {
  summary: ComparisonSummary;
  activeFilter: DiscrepancyFilter;
  onSelectFilter: (filter: DiscrepancyFilter) => void;
  isReanalyzing?: boolean;
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
  onExecutingChange?: (executing: boolean) => void;
}
