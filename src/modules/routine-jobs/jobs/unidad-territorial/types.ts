import type { DbConfig } from "@/core/types/db";
import type { TableLayout } from "../actualizar-padron/domain/layouts";
import type { StepTiming } from "../cargar-padrones/types";
import type { WritableTargetLayout } from "../shared/tableResolution";
import type { AddressMasterReport } from "../shared/addressMasterLinkReport";
import type { UnitSkipReason } from "./constants";

export interface UnitOptions {
  localityTypeName: string;
  tolerance: number;
  updateGeometries: boolean;
  linkAddressMaster?: boolean;
}

export interface UnitAddressMasterTable {
  schema: string;
  table: string;
}

export interface UnitParams {
  config: DbConfig;
  localitySchema: string;
  localityTable: string;
  typeSchema: string;
  typeTable: string;
  targetSchema: string;
  targetTable: string;
  addressMasterTable?: UnitAddressMasterTable;
  options: UnitOptions;
  dryRun: boolean;
  confirm: boolean;
}

export interface UnitLayouts {
  locality: TableLayout;
  type: TableLayout;
  target: WritableTargetLayout;
  unitTypeId: number;
  addressMaster?: WritableTargetLayout;
}

export interface UnitSkippedSample {
  name: string | null;
  provinceId: string | null;
  reason: UnitSkipReason;
}

export interface UnitSourceTotals {
  rowsRead: number;
  candidates: number;
  skipped: number;
}

export interface UnitSourceReport {
  totals: UnitSourceTotals;
  skippedByReason: Record<UnitSkipReason, number>;
  skippedSamples: UnitSkippedSample[];
}

export interface UnitKey {
  provinceId: string | null;
  name: string | null;
}

export interface UnitGeometryChange extends UnitKey {
  distance: number | null;
  areaRatio: number | null;
}

export interface UnitInserted extends UnitKey {
  id: number;
}

export interface UnitCounts {
  inserted: number;
  unchanged: number;
  withinTolerance: number;
  changed: number;
  ambiguous: number;
  missing: number;
  fontDiffers: number;
  updates: number;
}

export interface UnitClassification {
  counts: UnitCounts;
  missingSamples: UnitKey[];
  ambiguousSamples: UnitKey[];
  geometryChanges: UnitGeometryChange[];
}

export interface UnitApplyOutcome {
  inserted: number;
  updated: number;
  insertedList: UnitInserted[];
}

export interface UnitTargetReport {
  table: string;
  inserted: number;
  insertedList: UnitInserted[];
  updated: number;
  updateApplied: boolean;
  unchanged: number;
  unchangedWithinTolerance: number;
  changed: number;
  fontDiffers: number;
  missing: number;
  missingSamples: UnitKey[];
  ambiguous: number;
  ambiguousSamples: UnitKey[];
  geometryChanges: UnitGeometryChange[];
}

export interface UnitResult {
  dryRun: boolean;
  targetModified: boolean;
  outcomeUnknown: boolean;
  totals: UnitSourceTotals;
  skipped: Record<UnitSkipReason, number> & { samples: UnitSkippedSample[] };
  target: UnitTargetReport;
  addressMaster?: AddressMasterReport;
  warnings: string[];
  stepTimings: StepTiming[];
}
