import type { Geometry } from "geojson";
import type { DbConfig } from "@/core/types/db";
import type { WritableTargetLayout } from "../shared/tableResolution";
import type { StepTiming } from "../cargar-padrones/types";
import type {
  GeometryMapRole,
  GeometryState,
  PairChange,
  PairStatus,
  PairTier,
  RemovalSkipReason,
  ReplacementClass,
  SkipReason,
} from "./constants";
import type { TableLayout } from "./domain/layouts";
import type { AddressMasterReport } from "../shared/addressMasterLinkReport";

export type { StepTiming } from "../cargar-padrones/types";

/** The user's choice for an ambiguous group: the new row key as in a pairs_list element, and the destination id it pairs with (null: insert as new). */
export interface PairChoice {
  typePadron: string;
  provinceId: number;
  localityId: number | null;
  number: string;
  oldId: number | null;
}

/** A pending geometry change the user accepted: the staging key of its CHANGED row. Accepting applies it whatever its area ratio (AP-100). */
export interface AcceptedGeometry {
  typePadron: string;
  provinceId: number;
  localityId: number | null;
  number: string;
}

export interface ActualizarPadronOptions {
  localityType?: string;
  tolerance: number;
  geometryAreaThreshold: number;
  updateGeometries: boolean;
  linkAddressMaster: boolean;
  pairChoices: readonly PairChoice[];
  /** Absent means none: the request parser always fills it. */
  acceptedGeometries?: readonly AcceptedGeometry[];
  /** Absent means false: accepts every pending geometry change, whatever the list shows (AP-116). */
  acceptAllGeometries?: boolean;
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
  planId?: string;
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
  otherDepartments?: string[];
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

/** A deleted padrón (or, in an analysis, one that would be): its id and the destination's own names. */
export type PadronRemoved = PadronInserted;

/** Where a padron's geometry sits and how big it is: the areas are m² (SRID of the destination), the centroid is WGS84. */
export interface PadronLocation {
  oldAreaM2: number | null;
  newAreaM2: number | null;
  areaChangePct: number | null;
  centroidLat: number | null;
  centroidLon: number | null;
}

export interface PadronGeometryChange extends PadronNamedKey, PadronLocation {
  oldId: number | null;
  state: GeometryState;
}

/** A new row and the unmatched destination row it reclassifies or renumbers; the old key is the destination's. */
export interface PadronPair extends PadronLocation {
  status: PairStatus;
  tier: PairTier;
  changes: PairChange[];
  oldId: number | null;
  old: PadronNamedKey;
  new: PadronNamedKey;
  overlap: number | null;
  areaRatio: number | null;
}

export interface ActualizarTotals {
  rowsRead: number;
  candidates: number;
  repaired: number;
  skipped: number;
}

/** Where a missing padrón's old geometry is referenced (AP-102): every carto-schema table the catalog scan finds with an
    `id_padron` column, never limited to a hardcoded list. `byTable` keys are `schema.table` labels. */
export interface MissingPadronRefs {
  total: number;
  byTable: Record<string, number>;
}

/** The missing padrones that are not deleted (AP-105), grouped by reason. */
export interface RemovalSkippedReport {
  total: number;
  byReason: Record<RemovalSkipReason, number>;
}

/** The staging key of a replacing padrón (the new row): what the map reads back from the staging table. The department is the missing padrón's. */
export interface MissingPartKey {
  typePadron: string | null;
  number: string | null;
  locality: string | null;
}

/** A destination padrón with no staging row and no applied pair. `coveredPct` is the union of the replacing padrones (each at least REPLACEMENT_PART_MIN_PCT). `partKeys` lists the same parts as `parts`, in the same order. */
export interface MissingPadron {
  oldId: number;
  typePadron: string | null;
  provinceId: number | null;
  department: string | null;
  locality: string | null;
  number: string | null;
  oldAreaM2: number | null;
  centroidLat: number | null;
  centroidLon: number | null;
  class: ReplacementClass;
  coveredPct: number | null;
  parts: string[];
  partKeys?: MissingPartKey[];
  refs?: MissingPadronRefs;
  /** Why this padrón is not deleted (AP-101); null when it will be. */
  removalReason: RemovalSkipReason | null;
  /** AP-110: per `schema.table`, why its rows cannot be moved to a part; empty when none blocks (absent in older results). */
  reassignBlockers?: Record<string, string>;
}

/** A staging key for the map: a RURAL padrón has no locality, an URBANO one names its locality (nomloccat). */
export interface GeometryMapStagingKey {
  typePadron: string;
  department: string;
  locality: string | null;
  number: string;
}

/** One entry of the map request: an old destination id, a staging key, or both (a pair). */
export interface GeometryMapItem {
  oldId?: number;
  staging?: GeometryMapStagingKey;
}

export type { GeometryMapRole } from "./constants";

export interface GeometryMapFeature {
  itemIndex: number;
  role: GeometryMapRole;
  label: string;
  geometry: Geometry;
}

export type MissingByClass = Record<ReplacementClass, number>;

export interface PadronCounts {
  inserted: number;
  unchanged: number;
  withinTolerance: number;
  changed: number;
  ambiguous: number;
  missing: number;
  missingByClass: MissingByClass;
  updates: number;
  pairs: number;
  pairsLoose: number;
  pairsTotal: number;
  pairsPending: number;
  pairsNotApplied: number;
  choicesUnapplied: number;
  geometryPending: number;
  geometryAcceptsUnapplied: number;
  /** The delete-eligible missing padrón count (AP-105); a planned write. */
  removed: number;
  removalsSkipped: RemovalSkippedReport;
  /** AP-112: the referencing rows the real run will move, the subdivided padrones it will then delete, and the rows per table. */
  reassigned: number;
  subdividedDeleted: number;
  reassignedByTable: Record<string, number>;
  /** AP-111: of `reassigned`, the rows with no usable point, sent to the receiver covering most of the old padrón. */
  reassignedWithoutPoint: number;
}

/** Cheap facts of the destination and the staging side, read in the classify statement; the digest covers the planned writes. */
export interface PadronDataFingerprint {
  targetRows: number;
  targetMaxId: number;
  stagingCandidates: number;
  digest: string;
}

export interface PlanExpectedCounts {
  inserted: number;
  updates: number;
  pairs: number;
}

/** What an analysis saw and expects a real run to write: a persist must reproduce it exactly. */
export interface PlanSnapshot {
  dataFingerprint: PadronDataFingerprint;
  expected: PlanExpectedCounts;
}

/** A stored analysis. It holds no password: the real run must still send its own. The uncapped pending geometry list is served as a CSV, never in a payload. */
export interface ActualizarPlanRecord extends PlanSnapshot {
  planId: string;
  paramsFingerprint: string;
  createdAt: string;
  expiresAt: string;
  pendingGeometryChanges: PadronGeometryChange[];
}

export interface PadronClassification {
  counts: PadronCounts;
  fingerprint: PadronDataFingerprint;
  missingSamples: PadronKey[];
  missingReview: MissingPadron[];
  ambiguousSamples: PadronKey[];
  geometryChanges: PadronGeometryChange[];
  pendingGeometryChanges: PadronGeometryChange[];
  pairs: PadronPair[];
  /** The first DETAIL_LIST_LIMIT delete-eligible padrones (AP-108); the full set only ever lives in the database (AP-106). */
  removedList: PadronRemoved[];
}

export interface PadronApplyOutcome {
  inserted: number;
  updated: number;
  paired: number;
  insertedList: PadronInserted[];
}

/** The outcome of AP-106's delete statement: `deleted` and `surviving` are the same count by construction, verified as AP-48 does. `masterDeleted` counts the address master rows deleted with their padrón (AP-114). */
export interface PadronDeleteOutcome {
  deleted: number;
  surviving: number;
  masterDeleted: number;
  removedList: PadronRemoved[];
}

/** The outcome of AP-113's reassign statement: the rows moved (checked against the classification), per `schema.table`, and the padrones handed to the delete ids. */
export interface PadronReassignOutcome {
  moved: number;
  byTable: Record<string, number>;
  withoutPoint: number;
  padrones: number;
}

export interface ActualizarTargetReport {
  table: string;
  schema: string;
  inserted: number;
  insertedList: PadronInserted[];
  updated: number;
  updateApplied: boolean;
  unchanged: number;
  unchangedWithinTolerance: number;
  changed: number;
  missing: number;
  missingSamples: PadronKey[];
  missingByClass: MissingByClass;
  missingReview: MissingPadron[];
  ambiguous: number;
  ambiguousSamples: PadronKey[];
  geometryChanges: PadronGeometryChange[];
  geometryPending: number;
  pairs: PadronPair[];
  pairsTotal: number;
  pairsApplied: number;
  pairsLoose: number;
  pairsPending: number;
  pairsNotApplied: number;
  choicesUnapplied: number;
  /** Accepted geometries that did not end applied (AP-100); absent in results of older runs. */
  geometryAcceptsUnapplied?: number;
  /** The deleted padrón count (AP-106), the missing padrones that were not deleted (AP-105) and the first DETAIL_LIST_LIMIT deleted ones (AP-108); absent in results of older runs. */
  removed?: number;
  removalsSkipped?: RemovalSkippedReport;
  removedList?: PadronRemoved[];
  /** AP-115: the referencing rows of the subdivided padrones moved (a real run) or to move (an analysis) to their parts, and how many per `schema.table`. */
  reassigned?: number;
  reassignedByTable?: Record<string, number>;
  /** AP-111: of `reassigned`, the rows moved without a point to the largest receiver. */
  reassignedWithoutPoint?: number;
  /** Set when the reference scan could not vouch for every referencing table: nothing was deleted (AP-102). */
  removalBlockedReason?: string;
}

export type ActualizarAddressMasterReport = AddressMasterReport;

export interface ActualizarPadronBackup {
  token: string;
  fileName: string;
  bytes: number;
  counts: {
    updated: number;
    paired: number;
    inserted: number;
    addressMasterRows: number;
    deleted: number;
    /** AP-115: the referencing rows moved to a part and the address master rows deleted with their padrón; absent in results of older runs. */
    reassigned?: number;
    masterDeleted?: number;
  };
}

export interface ActualizarPadronResult {
  dryRun: boolean;
  targetModified: boolean;
  outcomeUnknown: boolean;
  totals: ActualizarTotals;
  skipped: SkippedReport;
  target: ActualizarTargetReport;
  addressMaster?: ActualizarAddressMasterReport;
  backup?: ActualizarPadronBackup;
  planId?: string;
  warnings: string[];
  stepTimings: StepTiming[];
}
