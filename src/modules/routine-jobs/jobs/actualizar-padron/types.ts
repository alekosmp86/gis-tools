import type { DbConfig } from "@/core/types/db";
import type { WritableTargetLayout } from "../shared/tableResolution";
import type { StepTiming } from "../cargar-padrones/types";
import type { SkipReason } from "./constants";
import type { TableLayout } from "./domain/layouts";
import type { AddressMasterAmbiguous, AddressMasterCounts, AddressMasterLinked } from "../shared/addressMasterLinkPass";

export type { StepTiming } from "../cargar-padrones/types";

export interface ActualizarPadronOptions {
  localityType?: string;
  tolerance: number;
  updateGeometries: boolean;
  linkAddressMaster: boolean;
}

export interface ActualizarPadronParams {
  config: DbConfig;
  stagingSchema: string;
  stagingTable: string;
  cartoSchema: string;
  targetTable: string;
  provinceTable: string;
  localityTable: string;
  typeTable?: string;
  addressMasterTable?: string;
  options: ActualizarPadronOptions;
  dryRun: boolean;
  confirm: boolean;
}

export interface PadronLayouts {
  staging: TableLayout;
  target: WritableTargetLayout;
  province: TableLayout;
  locality: TableLayout;
  type?: TableLayout;
  localityTypeId?: number;
  addressMaster?: WritableTargetLayout;
}

export interface SkippedGroup {
  name: string | null;
  count: number;
}

export interface SkippedLocalityGroup {
  department: string | null;
  locality: string | null;
  reason: string;
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
  byLocalityAndReason: SkippedLocalityGroup[];
  samples: SkippedSample[];
  skippedRows: SkippedSample[];
  collidingKeys: CollidingKey[];
  collidingKeyCount: number;
}

/** The natural key of a padron row, as ids: the destination rows are only known by their ids. */
export interface PadronKey {
  typePadron: string | null;
  provinceId: number | null;
  localityId: number | null;
  number: string | null;
}

/** A key with the staging names of the padron, for the rows the staging table provided. */
export interface PadronNamedKey extends PadronKey {
  department: string | null;
  locality: string | null;
}

export interface PadronInserted extends PadronNamedKey {
  id: number;
}

export interface PadronGeometryChange extends PadronNamedKey {
  distance: number | null;
  areaRatio: number | null;
}

export interface ActualizarTotals {
  rowsRead: number;
  candidates: number;
  repaired: number;
  skipped: number;
}

export interface PadronCounts {
  inserted: number;
  unchanged: number;
  withinTolerance: number;
  changed: number;
  ambiguous: number;
  missing: number;
  updates: number;
}

export interface PadronClassification {
  counts: PadronCounts;
  missingSamples: PadronKey[];
  ambiguousSamples: PadronKey[];
  geometryChanges: PadronGeometryChange[];
}

export interface PadronApplyOutcome {
  inserted: number;
  updated: number;
  insertedList: PadronInserted[];
}

export interface ActualizarTargetReport {
  table: string;
  inserted: number;
  insertedList: PadronInserted[];
  updated: number;
  updateApplied: boolean;
  unchanged: number;
  unchangedWithinTolerance: number;
  changed: number;
  missing: number;
  missingSamples: PadronKey[];
  ambiguous: number;
  ambiguousSamples: PadronKey[];
  geometryChanges: PadronGeometryChange[];
}

export type ActualizarAddressMasterCounts = AddressMasterCounts & { toCreate: number; remaining: number };

export interface ActualizarAddressMasterReport {
  table: string;
  counts: ActualizarAddressMasterCounts;
  linkedList: AddressMasterLinked[];
  ambiguousSamples: AddressMasterAmbiguous[];
}

export interface ActualizarPadronResult {
  dryRun: boolean;
  targetModified: boolean;
  outcomeUnknown: boolean;
  totals: ActualizarTotals;
  skipped: SkippedReport;
  target: ActualizarTargetReport;
  addressMaster?: ActualizarAddressMasterReport;
  warnings: string[];
  stepTimings: StepTiming[];
}
