import type { DbColumnMetadata, DbConfig } from "@/core/types/db";
import type { AnalyzeOutcome } from "@/core/types/replace";
import type { ClearMode } from "../cargar-padrones/constants";
import type { StepTiming } from "../cargar-padrones/types";
import type { SkipReason } from "./constants";

export type { RunDeps, RunProgress, RunSession, StepTiming } from "../cargar-padrones/types";

export type WorkCatalogColumn = DbColumnMetadata & { is_identity: boolean };

export interface ActualizarPadronOptions {
  clearMode: ClearMode;
}

export interface ActualizarPadronParams {
  config: DbConfig;
  stagingSchema: string;
  stagingTable: string;
  workSchema: string;
  workTable: string;
  padronTable: string;
  provinceTable: string;
  localityTable: string;
  options: ActualizarPadronOptions;
  dryRun: boolean;
  confirm: boolean;
}

export interface SkippedGroup {
  name: string | null;
  count: number;
}

export interface SkippedSample {
  department: string | null;
  locality: string | null;
  padron: string | null;
  reason: string;
}

export interface CollidingKey {
  typePadron: string | null;
  idProvince: number | null;
  idCadastralLocality: number | null;
  number: string | null;
  rows: number;
}

export interface SkippedReport {
  byReason: Record<SkipReason, number>;
  byDepartment: SkippedGroup[];
  byLocality: SkippedGroup[];
  samples: SkippedSample[];
  collidingKeys: CollidingKey[];
  collidingKeyCount: number;
}

export interface ActualizarTotals {
  rowsRead: number;
  accepted: number;
  written: number;
  repaired: number;
  skipped: number;
}

export interface ActualizarPadronResult {
  dryRun: boolean;
  tempModified: boolean;
  padronModified: boolean;
  outcomeUnknown: boolean;
  totals: ActualizarTotals;
  skipped: SkippedReport;
  warnings: string[];
  stepTimings: StepTiming[];
  analyze: AnalyzeOutcome;
}
