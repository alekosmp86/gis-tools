import type { Geometry } from "geojson";
import type { DbConfig } from "@/core/types/db";
import type { TableLayout } from "../actualizar-padron/domain/layouts";
import type { StepTiming } from "../cargar-padrones/types";
import type { WritableTargetLayout } from "../shared/tableResolution";
import type {
  EJES_LOAD_ROLES,
  EJES_SPLIT_POINTS_ROLES,
  EJES_SUMMARY_COUNT_KEYS,
  EjesPointReason,
  EjesSkipKind,
  EjesSkipReason,
  EjesTableRole,
  GeoTwinRole,
  PadronType,
  RenumberSkipReason,
  TwinClass,
} from "./constants";

export interface EjesTableRef {
  schema: string;
  table: string;
}

export type EjesTables = Record<EjesTableRole, EjesTableRef>;

/** A user's destination for one review point of an accepted split: one of that split's pieces, by its `reftramo`. */
export interface EjesPointChoice {
  pointId: string;
  newRef: string;
}

/** An accepted split by its old `reftramo`, with the choices for its review points (none when all points are automatic). */
export interface EjesAcceptedSplit {
  oldRef: string;
  choices: EjesPointChoice[];
}

/** The copy a user keeps for a `reftramo` with several copies: its `reftramo`, department and locality (as the staging holds them, trimmed). */
export interface EjesTwinPick {
  ref: string;
  department: string;
  locality: string;
}

/** The review rows the user accepted: splits by old `reftramo` (with choices), plain removals by `reftramo`, merges by the new `reftramo` (the old ones are derived server-side). */
export interface EjesAccepted {
  splits: EjesAcceptedSplit[];
  plainRemovals: string[];
  merges: string[];
  /** Geometric twin losers in carto, by `reftramo` (ET-26): removed only when accepted per row. */
  twinRemovals: string[];
  /** One copy kept per `reftramo` with several copies (ET-28): the locality rule does not apply to that `reftramo`. */
  twinPicks: EjesTwinPick[];
}

export interface EjesParams {
  config: DbConfig;
  tables: EjesTables;
  dryRun: boolean;
  summary?: EjesSummary;
  accepted?: EjesAccepted;
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
  /** Geometric twins (ET-20 to ET-27): groups, members, losers not in carto (omitted), losers in carto (removable), reftramos skipped by the conservative rule. */
  geoTwinGroups: number;
  geoTwinSections: number;
  geoTwinLosersOmitted: number;
  geoTwinLosersRemovable: number;
  geoTwinSkippedRefs: number;
  twinsUrban: number;
  twinsRural: number;
  twinsBoth: number;
  twinsNeither: number;
  twinsCrossDepartment: number;
  twinsDrop: number;
  twinsKeep: number;
  twinsUndecided: number;
  twinPicksApplied: number;
  renumbered: number;
  renumberedWithPoints: number;
  renumberedPoints: number;
  renumberSkipped: number;
  splitPointsTotal: number;
  splitPointsAuto: number;
  splitPointsReview: number;
  splitPointsNoGeometry: number;
  splitPointsFar: number;
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
  /** Every access point of the old section: by `reftramo` and by `road_section.id`. */
  points: number;
  /** The points by `reftramo` that the split decides on (the four counts below add up to this one). */
  refPoints: number;
  autoPoints: number;
  reviewPoints: number;
  noGeometryPoints: number;
  farPoints: number;
  /** The reason the load holds this split whatever the user chooses (the rules of `splitGroupsSql`); null when none holds it. */
  heldReason: EjesSkipReason | null;
  /** True when the review points of this split did not fit the stored review rows: its choices cannot be checked, so it is not acceptable. */
  incompleteReview: boolean;
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

/** One member of a geometric twin group: its role, its partners (other refs of the group), and whether it is in carto. */
export interface EjesGeoTwinRow {
  ref: string;
  idcalle: string | null;
  localidad: string | null;
  departamento: string | null;
  groupKey: string;
  partners: string[];
  role: GeoTwinRole;
  inCarto: boolean;
  points: number;
  /** The member the group keeps (a keeper, else the winner): the one a loser's copy is removed in favour of. */
  keeperRef: string;
  keeperPoints: number;
  keeperLength: number | null;
  keeperFuente: string | null;
  keeperInCarto: boolean;
}

export interface EjesTwinCopy {
  department: string | null;
  locality: string | null;
}

/** A `reftramo` that keeps several copies after the rules and the picks: its copies, its points, and the held rows waiting for one copy. */
export interface EjesTwinUndecidedRow {
  ref: string;
  idcalle: string | null;
  name: string | null;
  copies: EjesTwinCopy[];
  points: number;
  waiting: number;
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

/** A candidate piece of a stored review point: its `reftramo` and its distance in metres (null without geometry). */
export interface EjesStoredCandidate {
  newRef: string;
  distance: number | null;
}

/** A review point of a dry run, kept server side for its review (never in the job status). */
export interface EjesStoredReviewPoint {
  oldRef: string;
  pointId: string;
  reason: EjesPointReason;
  suggestedRef: string | null;
  candidates: EjesStoredCandidate[];
}

/** The review points of the kept dry runs, by job: read by the review page, written when a dry run finishes. */
export interface EjesReviewStore {
  retain(jobId: string, points: EjesStoredReviewPoint[]): void;
  read(jobId: string): EjesStoredReviewPoint[] | undefined;
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
  twinUndecided: EjesTwinUndecidedRow[];
  geoTwins: EjesGeoTwinRow[];
  renumbered: EjesRenumberedRow[];
  renumberSkipped: EjesRenumberSkippedRow[];
  fingerprint: EjesFingerprint;
  /** The review points of a dry run, stored server side and stripped from the job result (see `withReviewRetention`). */
  reviewPoints?: EjesStoredReviewPoint[];
}

export interface EjesResolvedLayouts {
  layouts: EjesLayouts;
  writeTargets: WritableTargetLayout[];
  /** Problems of `carto.address` geometry (SRID): information in a dry run, a blocker in a real run. */
  addressIssues: string[];
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
  localitiesOf?: string;
  departmentOf?: string;
  type?: PadronType;
}

export interface EjesMapFeature {
  itemIndex: number;
  role: "old" | "new" | "zone" | "locality" | "department";
  label: string;
  geometry: Geometry;
}

export interface EjesGeometryMapParams {
  config: DbConfig;
  staging: EjesTableRef;
  roadSection: EjesTableRef;
  padrones: EjesTableRef;
  localities: EjesTableRef;
  departments: EjesTableRef;
  items: EjesMapItem[];
}

/** One page of the review points of one split, read from the dry run `jobId` keeps: the tables the read touches by key, the old `reftramo`, the window. */
export interface EjesSplitPointsParams {
  config: DbConfig;
  tables: Pick<EjesTables, (typeof EJES_SPLIT_POINTS_ROLES)[number]>;
  jobId: string;
  oldRef: string;
  offset: number;
  limit: number;
}

/** A piece the point could go to. `distance` is in metres (one decimal) and null when the point has no geometry. */
export interface EjesSplitPointCandidate {
  newRef: string;
  distance: number | null;
  isSuggestion: boolean;
}

export interface EjesSplitReviewPoint {
  pointId: string;
  reason: EjesPointReason;
  number: string | null;
  letter: string | null;
  km: string | null;
  circulationWay: string | null;
  /** The point in WGS84; null when the point has no usable address geometry. */
  geometry: Geometry | null;
  /** The street of the access point; null when the point has no `idcalle`. */
  pointStreet: EjesStreet | null;
  candidates: EjesSplitPointCandidate[];
}

/** A street named by its `idcalle` (the old section's or the access point's); `name` is null when no circulation way of it has a name. */
export interface EjesStreet {
  idcalle: string;
  name: string | null;
}

/** A piece of the split, in WGS84, sent once per page and shared by its points. */
export interface EjesSplitPiece {
  newRef: string;
  geometry: Geometry;
}

export interface EjesSplitPointsPage {
  oldRef: string;
  /** Every review point of the split, listed or not. */
  total: number;
  offset: number;
  limit: number;
  points: EjesSplitReviewPoint[];
  pieces: EjesSplitPiece[];
  /** The old section in WGS84; null when the section has no geometry. */
  oldGeometry: Geometry | null;
  /** The street of the old section; null when the section is not found or has no `idcalle`. */
  oldStreet: EjesStreet | null;
  /** Problems of the address geometry (SRID): every point without them is a point without geometry. */
  addressIssues: string[];
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
  removed: number;
  merged: number;
  splitsApplied: number;
  deleted: number;
  waysCreated: number;
  /** Every access point the load moved: renumbered, merged and split points. */
  pointsMoved: number;
  /** Sections of the topology set that hold a source and a target after pgr_createTopology. */
  topologyAssigned: number;
  verticesCreated: number;
  verticesDeleted: number;
  /** Geometric twin losers in carto removed by the load (their own skip kind is `twin`). */
  twinsRemoved: number;
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
  kind: EjesSkipKind;
  refs: string[];
  newRefs: string[];
  idcalle: string | null;
  points: number;
  reason?: EjesSkipReason;
}

export interface EjesBackup {
  token: string;
  fileName: string;
  bytes: number;
  counts: { updated: number; inserted: number; ways: number; masters: number; pointsMoved: number; deleted: number };
}

export interface EjesNextStep {
  text: string;
  statement: string;
}

export interface EjesSkipCount {
  reason: EjesSkipReason;
  count: number;
}

export interface EjesLoadReport {
  counts: EjesLoadCounts;
  surplus: EjesSurplusRow[];
  surplusTotal: number;
  renumbered: EjesLoadRenumberedRow[];
  /** The first DETAIL_LIST_LIMIT skipped rows; `skippedTotal` and `skippedByReason` count all of them. */
  skipped: EjesSkippedRow[];
  skippedTotal: number;
  skippedByReason: EjesSkipCount[];
  backup?: EjesBackup;
}
