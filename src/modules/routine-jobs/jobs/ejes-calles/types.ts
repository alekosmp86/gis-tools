import type { Geometry } from "geojson";
import type { DbConfig } from "@/core/types/db";
import type { TableLayout } from "../actualizar-padron/domain/layouts";
import type { StepTiming } from "../cargar-padrones/types";
import type { WritableTargetLayout } from "../shared/tableResolution";
import type { EJES_LOAD_ROLES, EJES_SUMMARY_COUNT_KEYS, EjesTableRole, PadronType, RenumberSkipReason, TwinClass } from "./constants";

export interface EjesTableRef {
  schema: string;
  table: string;
}

export type EjesTables = Record<EjesTableRole, EjesTableRef>;

export interface EjesParams {
  config: DbConfig;
  tables: EjesTables;
  dryRun: boolean;
  summary?: EjesSummary;
}

export type EjesLayouts = Record<EjesTableRole, TableLayout>;

export interface EjesUnknownValue {
  value: string | null;
  rows: number;
}

export interface EjesInvalidGeometryRow {
  ref: string;
  idcalle: string | null;
  localidad: string | null;
  departamento: string | null;
}

export interface EjesStagingReport {
  rows: number;
  distinctRefs: number;
  repeatedGroups: number;
  repeatedRows: number;
  nonIntegerRefs: number;
  emptyGeometry: number;
  emptyIdcalle: number;
  invalidGeometryRows: number;
  invalidGeometryRefs: number;
  invalidGeometries: EjesInvalidGeometryRow[];
  damagedTextRows: number;
  unknownTipoRows: number;
  unknownFuenteRows: number;
  unknownTipos: EjesUnknownValue[];
  unknownFuentes: EjesUnknownValue[];
}

export interface EjesCounts {
  newSections: number;
  unchanged: number;
  attr: number;
  geom: number;
  both: number;
  removed: number;
  splits: number;
  merges: number;
  plainRemovals: number;
  plainHeld: number;
  newStreets: number;
  twins: number;
  twinsUrban: number;
  twinsRural: number;
  twinsBoth: number;
  twinsNeither: number;
  twinsCrossDepartment: number;
  twinsDrop: number;
  twinsKeep: number;
  renumbered: number;
  renumberedWithPoints: number;
  renumberedPoints: number;
  renumberSkipped: number;
}

export interface EjesClocReport {
  withLocality: number;
  onlyDepartment: number;
  withoutCode: number;
}

export interface EjesSplitRow {
  oldRef: string;
  idcalle: string | null;
  newRefs: string[];
  points: number;
  coverage: number | null;
  oldLength: number | null;
  newLength: number | null;
  outsideLength: number | null;
}

export interface EjesMergeRow {
  newRef: string;
  idcalle: string | null;
  oldRefs: string[];
  points: number;
  coverage: number | null;
  oldLength: number | null;
  newLength: number | null;
  outsideLength: number | null;
}

export interface EjesRemovalRow {
  ref: string;
  idcalle: string | null;
  points: number;
}

export interface EjesNewStreetRow {
  idcalle: string | null;
  name: string | null;
  shortName: string | null;
  sections: number;
  tipos: string | null;
  departments: string | null;
  localities: string | null;
}

export interface EjesAttrRow {
  ref: string;
  name: string | null;
  currentName: string | null;
  idcalle: string | null;
  currentIdcalle: string | null;
  typeId: number | null;
  currentTypeId: number | null;
  fontId: number | null;
  currentFontId: number | null;
}

export interface EjesTwinRow {
  ref: string;
  idcalle: string | null;
  department: string | null;
  localities: string[];
  class: TwinClass;
  length: number | null;
  urbanLength: number | null;
  ruralLength: number | null;
  dropLocalities: string[];
  insideLocalities: string[];
}

export interface EjesRenumberedRow {
  oldRef: string;
  newRef: string;
  idcalle: string | null;
  points: number;
  oldLength: number | null;
  newLength: number | null;
  hausdorff: number | null;
}

export interface EjesRenumberSkippedRow {
  oldRef: string;
  newRef: string;
  idcalle: string | null;
  points: number;
  reason: RenumberSkipReason;
}

/** The staging as the analysis reads it: its row count and an md5 over its rows (see `fingerprintCtes`). */
export interface EjesFingerprint {
  rows: number;
  digest: string;
}

export interface EjesAnalysis {
  counts: EjesCounts;
  cloc: EjesClocReport;
  splits: EjesSplitRow[];
  merges: EjesMergeRow[];
  plainRemovals: EjesRemovalRow[];
  newStreets: EjesNewStreetRow[];
  attrChanges: EjesAttrRow[];
  twins: EjesTwinRow[];
  renumbered: EjesRenumberedRow[];
  renumberSkipped: EjesRenumberSkippedRow[];
  fingerprint: EjesFingerprint;
}

export interface EjesResolvedLayouts {
  layouts: EjesLayouts;
  writeTargets: WritableTargetLayout[];
}

export interface EjesResult extends EjesAnalysis {
  dryRun: boolean;
  targetModified: boolean;
  outcomeUnknown: boolean;
  commitError?: string;
  load?: EjesLoadReport;
  nextStep?: EjesNextStep;
  staging: EjesStagingReport;
  blockers: string[];
  privilegeInfo: string[];
  tables: Record<EjesTableRole, string>;
  stepTimings: StepTiming[];
}

/** One outline to draw: an old section by its `reftramo_ideuy`, a new one by its staging `reftramo`, or the padrones of a type near a new one. */
export interface EjesMapItem {
  oldRef?: number;
  newRef?: string;
  locality?: string;
  zoneOf?: string;
  type?: PadronType;
}

export interface EjesMapFeature {
  itemIndex: number;
  role: "old" | "new" | "zone";
  label: string;
  geometry: Geometry;
}

export interface EjesGeometryMapParams {
  config: DbConfig;
  staging: EjesTableRef;
  roadSection: EjesTableRef;
  padrones: EjesTableRef;
  items: EjesMapItem[];
}

export type EjesSummaryCountKey = (typeof EJES_SUMMARY_COUNT_KEYS)[number];

/** The counts and the staging fingerprint of the Revisar analysis: the real run only goes on when the staging still gives the same ones. */
export interface EjesSummary {
  counts: Record<EjesSummaryCountKey, number>;
  fingerprint: EjesFingerprint;
}

export type EjesLoadRole = (typeof EJES_LOAD_ROLES)[number];

export interface EjesLoadContext {
  layouts: EjesLayouts;
  targets: Record<EjesLoadRole, WritableTargetLayout>;
}

export interface EjesLoadCounts {
  inserted: number;
  updated: number;
  renumbered: number;
  renumberSkipped: number;
  waysCreated: number;
  pointsMoved: number;
}

export interface EjesSurplusRow {
  ref: string;
  id: string;
  points: number;
}

export interface EjesLoadRenumberedRow {
  oldRef: string;
  newRef: string;
  id: string;
  points: number;
}

export interface EjesSkippedRow {
  kind: "split" | "merge" | "removal" | "renumber";
  refs: string[];
  idcalle: string | null;
  points: number;
  reason?: RenumberSkipReason;
}

export interface EjesBackup {
  token: string;
  fileName: string;
  bytes: number;
  counts: { updated: number; inserted: number; ways: number; masters: number; pointsMoved: number };
}

export interface EjesNextStep {
  text: string;
  statement: string;
}

export interface EjesLoadReport {
  counts: EjesLoadCounts;
  surplus: EjesSurplusRow[];
  surplusTotal: number;
  renumbered: EjesLoadRenumberedRow[];
  skipped: EjesSkippedRow[];
  backup?: EjesBackup;
}
