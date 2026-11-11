import type { DbColumnMetadata, DbConfig } from "@/core/types/db";
import type { TableLayout } from "../actualizar-padron/domain/layouts";
import type { StepTiming } from "../cargar-padrones/types";
import type { WritableTargetLayout } from "../shared/tableResolution";
import type { CentrosTableRole } from "./constants";

export interface CentrosTableRef {
  schema: string;
  table: string;
}

export type CentrosTables = Record<CentrosTableRole, CentrosTableRef>;

export interface CentrosParams {
  config: DbConfig;
  tables: CentrosTables;
  dryRun: boolean;
  confirm: boolean;
}

export interface CentrosColumnPair {
  source: string;
  target: string;
  isGeometry: boolean;
}

export interface CentrosTypeMismatch {
  column: string;
  stagingType: string;
  finalType: string;
}

export interface CentrosColumnPlan {
  pairs: CentrosColumnPair[];
  skippedDefaults: string[];
  missingInFinal: string[];
  missingInStaging: string[];
  typeMismatches: CentrosTypeMismatch[];
  requiredWithoutValue: string[];
}

export interface CentrosStagingLayout {
  layout: TableLayout;
  catalog: DbColumnMetadata[];
  srid: number | undefined;
}

export interface CentrosFinalLayout extends WritableTargetLayout {
  srid: number;
}

export interface CentrosResolved {
  staging: CentrosStagingLayout;
  final: CentrosFinalLayout;
  defaultSequenceTargets: WritableTargetLayout[];
  plan: CentrosColumnPlan;
  schemaBlockers: string[];
}

export interface CentrosCountRow {
  value: string | null;
  rows: number;
}

export interface CentrosRepeatedRuee {
  ruee: string;
  rows: number;
}

export interface CentrosStagingReport {
  rows: number;
  bySubsistema: CentrosCountRow[];
  emptyGeometry: number;
  nullRuee: number;
  nullSubsistema: number;
  repeatedGroups: number;
  repeatedRows: number;
  repeatedRuee: CentrosRepeatedRuee[];
  damagedTextRows: number;
  unsupportedSridRows: number;
}

export interface CentrosFinalCounts {
  rows: number;
  bySubsistema: CentrosCountRow[];
}

export interface CentrosComparisonRow {
  value: string | null;
  current: number;
  after: number;
  difference: number;
}

export interface CentrosComparison {
  currentRows: number;
  afterRows: number;
  bySubsistema: CentrosComparisonRow[];
}

export interface CentrosBackup {
  token: string;
  fileName: string;
  bytes: number;
  rows: number;
}

export interface CentrosResult {
  dryRun: boolean;
  targetModified: boolean;
  outcomeUnknown: boolean;
  staging: CentrosStagingReport;
  comparison: CentrosComparison;
  blockers: string[];
  privilegeInfo: string[];
  columnInfo: string[];
  copiedColumns: string[];
  finalSrid: number;
  deleted: number;
  inserted: number;
  backup?: CentrosBackup;
  warnings: string[];
  tables: Record<CentrosTableRole, string>;
  stepTimings: StepTiming[];
}
