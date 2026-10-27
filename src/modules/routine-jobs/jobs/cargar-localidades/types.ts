import type { DbConfig } from "@/core/types/db";
import type { TableLayout } from "../actualizar-padron/domain/layouts";
import type { StepTiming } from "../cargar-padrones/types";
import type { WritableTargetLayout } from "../shared/tableResolution";
import type { LocalitySkipReason } from "./constants";

export interface LocalityOptions {
  tolerance: number;
  updateGeometries: boolean;
}

export interface LocalityTableRef {
  schema: string;
  table: string;
}

export interface CargarLocalidadesParams {
  config: DbConfig;
  stagingSchema: string;
  padronTable: string;
  localityStagingTable: string;
  provinceSchema: string;
  provinceTable: string;
  targets: LocalityTableRef[];
  options: LocalityOptions;
  dryRun: boolean;
  confirm: boolean;
}

export type LocalityTargetLayout = WritableTargetLayout;

export interface LocalityLayouts {
  padron: TableLayout;
  localities: TableLayout;
  province: TableLayout;
  targets: LocalityTargetLayout[];
}

export interface LocalitySkippedSample {
  department: string | null;
  locality: string | null;
  code: string | null;
  reason: LocalitySkipReason;
}

export interface SourceTotals {
  rowsRead: number;
  groups: number;
  repaired: number;
  candidates: number;
  skipped: number;
}

export interface SourceReport {
  totals: SourceTotals;
  skippedByReason: Record<LocalitySkipReason, number>;
  skippedSamples: LocalitySkippedSample[];
}

export interface LocalityKey {
  department: string | null;
  name: string | null;
}

export interface CodeDifference extends LocalityKey {
  code: string | null;
  targetCode: string | null;
}

export interface GeometryChange extends LocalityKey {
  distance: number | null;
  areaRatio: number | null;
}

export interface InsertedLocality extends LocalityKey {
  id: number;
}

export interface ClassificationCounts {
  inserted: number;
  unchanged: number;
  withinTolerance: number;
  changed: number;
  ambiguous: number;
  missing: number;
  codeDiffers: number;
}

export interface TargetClassification {
  counts: ClassificationCounts;
  missingSamples: LocalityKey[];
  ambiguousSamples: LocalityKey[];
  codeDiffersSamples: CodeDifference[];
  geometryChanges: GeometryChange[];
}

export interface TargetApplyOutcome {
  inserted: number;
  updated: number;
  insertedList: InsertedLocality[];
}

export interface TargetReport {
  table: string;
  inserted: number;
  insertedList: InsertedLocality[];
  updated: number;
  updateApplied: boolean;
  unchanged: number;
  unchangedWithinTolerance: number;
  changed: number;
  missing: number;
  missingSamples: LocalityKey[];
  ambiguous: number;
  ambiguousSamples: LocalityKey[];
  codeDiffers: number;
  codeDiffersSamples: CodeDifference[];
  geometryChanges: GeometryChange[];
}

export interface CargarLocalidadesResult {
  dryRun: boolean;
  targetsModified: boolean;
  outcomeUnknown: boolean;
  totals: SourceTotals;
  skipped: Record<LocalitySkipReason, number> & { samples: LocalitySkippedSample[] };
  targets: TargetReport[];
  warnings: string[];
  stepTimings: StepTiming[];
}

