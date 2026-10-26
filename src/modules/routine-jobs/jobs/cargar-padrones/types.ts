import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import type { DbConfig } from "@/core/types/db";
import type { AnalyzeOutcome } from "@/core/types/replace";
import type { LoadOptions } from "./domain/loadSql";

export interface CargarPadronesParams {
  config: DbConfig;
  schema: string;
  ruralTable: string;
  urbanoTable: string;
  targetTable: string;
  options: LoadOptions;
  dryRun: boolean;
  confirm: boolean;
}

export interface RunSession extends CatalogQuerySession {
  close(): Promise<void>;
}

export interface RunDeps {
  openSession(config: DbConfig): Promise<RunSession>;
  now(): number;
}

export interface AttributeConflictSample {
  key: string;
  column: string;
  values: string[];
}

export interface AmbiguousLocalityCode {
  coddepto: string | number | null;
  codloccat: string | number | null;
  nomloccat: string[];
}

export interface TypeReport {
  rowsRead: number;
  groups: number;
  rowsMerged: number;
  repaired: number;
  insertedInvalid: number;
  repairedInUnion: number;
  noGeometry: number;
  nullKeyRows: number;
  attributeConflicts: number;
  attributeConflictSamples: AttributeConflictSample[];
  inserted: number;
}

export interface LoadOutput {
  rural: TypeReport;
  urbano: TypeReport;
  ambiguousLocalityCodes: AmbiguousLocalityCode[];
}

export interface LoadTotals {
  rowsRead: number;
  groups: number;
  rowsMerged: number;
  inserted: number;
}

export interface StepTiming {
  label: string;
  ms: number;
}

export interface CargarPadronesResult {
  dryRun: boolean;
  targetModified: boolean;
  outcomeUnknown: boolean;
  report: {
    rural: TypeReport;
    urbano: TypeReport;
  };
  totals: LoadTotals;
  ambiguousLocalityCodes: AmbiguousLocalityCode[];
  warnings: string[];
  stepTimings: StepTiming[];
  analyze: AnalyzeOutcome;
}
