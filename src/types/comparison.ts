import type { DbConfig } from "@/types/db";
import type { ColumnMappingConfig } from "@/types/gis";
import type { ParsedFileDataset } from "@/types/parsers";

export const DiscrepancyType = {
  MATCH: "MATCH",
  ATTRIBUTE_MISMATCH: "ATTRIBUTE_MISMATCH",
  GEOMETRY_MISMATCH: "GEOMETRY_MISMATCH",
  ONLY_IN_DB: "ONLY_IN_DB",
  ONLY_IN_SHP: "ONLY_IN_SHP",
} as const;

export type DiscrepancyType = (typeof DiscrepancyType)[keyof typeof DiscrepancyType];

export const DiscrepancyFilter = {
  ALL: "ALL",
  MATCH: "MATCH",
  ATTRIBUTE_MISMATCH: "ATTRIBUTE_MISMATCH",
  GEOMETRY_MISMATCH: "GEOMETRY_MISMATCH",
  ONLY_IN_DB: "ONLY_IN_DB",
  ONLY_IN_SHP: "ONLY_IN_SHP",
} as const;

export type DiscrepancyFilter = (typeof DiscrepancyFilter)[keyof typeof DiscrepancyFilter];

export const ResultsViewTab = {
  TABLE: "table",
  SQL: "sql",
} as const;

export type ResultsViewTab = (typeof ResultsViewTab)[keyof typeof ResultsViewTab];

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
}

export interface ComparisonSummary {
  totalAnalyzed: number;
  exactMatchesCount: number;
  attributeMismatchCount: number;
  geometryMismatchCount: number;
  onlyInDbCount: number;
  onlyInShpCount: number;
  items: DiscrepancyItem[];
  sqlPatchScript: string;
}

export interface IComparisonEngine {
  readonly engineName: string;
  compare(
    dbConfig: DbConfig,
    dataset: ParsedFileDataset,
    mappingConfig: ColumnMappingConfig
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
  sqlScript: string;
  tableName: string;
}
