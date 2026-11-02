import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import { DETAIL_LIST_LIMIT, SAMPLE_LIMIT } from "../../shared/limits";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import {
  LOCALITY_REASON_GROUP_LIMIT,
  PAIR_CHANGE,
  REPLACEMENT_CLASS,
  SKIP_REASON,
  SKIPPED_GROUP_LIMIT,
  type GeometryState,
  type PairChange,
  type PairStatus,
  type PairTier,
  type ReplacementClass,
  type SkipReason,
} from "../constants";
import type {
  ActualizarTargetReport,
  CollidingKey,
  MissingByClass,
  MissingPadron,
  MissingPadronRefs,
  MissingPartKey,
  PadronApplyOutcome,
  PadronClassification,
  PadronCounts,
  PadronDataFingerprint,
  PadronGeometryChange,
  PadronInserted,
  PadronKey,
  PadronLocation,
  PadronNamedKey,
  PadronPair,
  SkippedGroup,
  SkippedLocalityGroup,
  SkippedReport,
  SkippedSample,
} from "../types";

export type ReportRow = Record<string, unknown>;

export interface ReportTotals {
  rowsRead: number;
  repaired: number;
  skipped: number;
  collidingKeys: number;
}

export interface ReportView {
  totals: ReportTotals;
  skipped: SkippedReport;
}

const SKIP_REASONS: readonly string[] = Object.values(SKIP_REASON);

const countOf = (value: unknown): number => Number(value ?? 0);
const textOf = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const numberOf = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
const isSkipReason = (value: string): value is SkipReason => SKIP_REASONS.includes(value);
const rowsOf = (value: unknown): ReportRow[] => (Array.isArray(value) ? (value as ReportRow[]) : []);

function toByReason(value: unknown): Record<SkipReason, number> {
  const counts = {} as Record<SkipReason, number>;
  for (const reason of SKIP_REASONS) {
    if (isSkipReason(reason)) counts[reason] = 0;
  }
  for (const row of rowsOf(value)) {
    const reason = textOf(row.reason);
    if (reason !== null && isSkipReason(reason)) counts[reason] = countOf(row.count);
  }
  return counts;
}

const toSkippedGroups = (value: unknown): SkippedGroup[] =>
  rowsOf(value)
    .slice(0, SKIPPED_GROUP_LIMIT)
    .map((row) => ({ name: textOf(row.name), count: countOf(row.count) }));

const toLocalityGroups = (value: unknown): SkippedLocalityGroup[] =>
  rowsOf(value)
    .slice(0, LOCALITY_REASON_GROUP_LIMIT)
    .map((row) => ({
      department: textOf(row.department),
      locality: textOf(row.locality),
      reason: textOf(row.reason) ?? "",
      count: countOf(row.count),
    }));

const toSkippedSamples = (value: unknown, limit: number): SkippedSample[] =>
  rowsOf(value)
    .slice(0, limit)
    .map((row) => ({
      department: textOf(row.department),
      locality: textOf(row.locality),
      padron: textOf(row.padron),
      reason: textOf(row.reason) ?? "",
    }));

const toCollidingKeys = (value: unknown): CollidingKey[] =>
  rowsOf(value)
    .slice(0, SAMPLE_LIMIT)
    .map((row) => ({
      typePadron: textOf(row.typePadron),
      idProvince: numberOf(row.idProvince),
      idCadastralLocality: numberOf(row.idCadastralLocality),
      number: textOf(row.number),
      rows: countOf(row.rows),
    }));

/* The report is one row: counts arrive as text (bigint) or number, the lists as parsed json arrays or null. */
export function toReportView(row: ReportRow | undefined): ReportView {
  const report: ReportRow = row ?? {};
  const totals: ReportTotals = {
    rowsRead: countOf(report.rowsRead),
    repaired: countOf(report.repaired),
    skipped: countOf(report.skipped),
    collidingKeys: countOf(report.collidingKeys),
  };
  return {
    totals,
    skipped: {
      byReason: toByReason(report.byReason),
      byDepartment: toSkippedGroups(report.byDepartment),
      byLocality: toSkippedGroups(report.byLocality),
      byLocalityAndReason: toLocalityGroups(report.byLocalityAndReason),
      samples: toSkippedSamples(report.samples, SAMPLE_LIMIT),
      skippedRows: toSkippedSamples(report.skippedList, DETAIL_LIST_LIMIT),
      collidingKeys: toCollidingKeys(report.collidingKeyList),
      collidingKeyCount: totals.collidingKeys,
    },
  };
}

const keyOf = (entry: ReportRow): PadronKey => ({
  typePadron: textOf(entry.typePadron),
  provinceId: numberOf(entry.provinceId),
  localityId: numberOf(entry.localityId),
  number: textOf(entry.number),
});

const namedKeyOf = (entry: ReportRow): PadronNamedKey => ({
  ...keyOf(entry),
  department: textOf(entry.department),
  locality: textOf(entry.locality),
});

const insertedOf = (entry: ReportRow): PadronInserted => ({ id: countOf(entry.id), ...namedKeyOf(entry) });

const locationOf = (entry: ReportRow): PadronLocation => ({
  oldAreaM2: numberOf(entry.oldAreaM2),
  newAreaM2: numberOf(entry.newAreaM2),
  areaChangePct: numberOf(entry.areaChangePct),
  centroidLat: numberOf(entry.centroidLat),
  centroidLon: numberOf(entry.centroidLon),
});

const geometryChangeOf = (entry: ReportRow): PadronGeometryChange => ({
  ...namedKeyOf(entry),
  ...locationOf(entry),
  oldId: numberOf(entry.oldId),
  state: entry.state as GeometryState,
});

const listOf = (value: unknown): ReportRow[] => rowsOf(value);

const textListOf = (value: unknown): string[] => (Array.isArray(value) ? value.map((entry) => String(entry)) : []);

const partKeyOf = (entry: ReportRow): MissingPartKey => ({
  typePadron: textOf(entry.typePadron),
  number: textOf(entry.number),
  locality: textOf(entry.locality),
});

const partKeysOf = (value: unknown): MissingPartKey[] => rowsOf(value).map(partKeyOf);

const missingByClassOf = (row: ReportRow): MissingByClass => ({
  [REPLACEMENT_CLASS.SUBDIVIDED]: countOf(row.missing_subdivided),
  [REPLACEMENT_CLASS.REPLACED_ONE]: countOf(row.missing_replaced_one),
  [REPLACEMENT_CLASS.PARTIAL]: countOf(row.missing_partial),
  [REPLACEMENT_CLASS.ORPHAN]: countOf(row.missing_orphan),
});

const refsOf = (entry: ReportRow): MissingPadronRefs | undefined => {
  const refs: MissingPadronRefs = {};
  if (entry.accessPointRefs !== undefined) refs.accessPoint = countOf(entry.accessPointRefs);
  if (entry.addressesRefs !== undefined) refs.addresses = countOf(entry.addressesRefs);
  return Object.keys(refs).length === 0 ? undefined : refs;
};

const missingPadronOf = (entry: ReportRow): MissingPadron => {
  const refs = refsOf(entry);
  return {
    oldId: countOf(entry.oldId),
    typePadron: textOf(entry.typePadron),
    provinceId: numberOf(entry.provinceId),
    department: textOf(entry.department),
    locality: textOf(entry.locality),
    number: textOf(entry.number),
    oldAreaM2: numberOf(entry.oldAreaM2),
    centroidLat: numberOf(entry.centroidLat),
    centroidLon: numberOf(entry.centroidLon),
    class: entry.class as ReplacementClass,
    coveredPct: numberOf(entry.coveredPct),
    parts: textListOf(entry.parts),
    partKeys: partKeysOf(entry.partKeys),
    ...(refs === undefined ? {} : { refs }),
  };
};

const PAIR_CHANGE_FLAGS: ReadonlyArray<readonly [string, PairChange]> = [
  ["typeChanged", PAIR_CHANGE.TYPE],
  ["localityChanged", PAIR_CHANGE.LOCALITY],
  ["numberChanged", PAIR_CHANGE.NUMBER],
];

const pairChangesOf = (entry: ReportRow): PairChange[] =>
  PAIR_CHANGE_FLAGS.filter(([flag]) => entry[flag] === true).map(([, change]) => change);

const pairOf = (entry: ReportRow): PadronPair => ({
  status: entry.status as PairStatus,
  tier: entry.tier as PairTier,
  changes: pairChangesOf(entry),
  oldId: numberOf(entry.oldId),
  old: {
    typePadron: textOf(entry.oldTypePadron),
    provinceId: numberOf(entry.provinceId),
    localityId: numberOf(entry.oldLocalityId),
    number: textOf(entry.oldNumber),
    department: textOf(entry.department),
    locality: textOf(entry.oldLocality),
  },
  new: namedKeyOf(entry),
  overlap: numberOf(entry.overlap),
  areaRatio: numberOf(entry.areaRatio),
  ...locationOf(entry),
});

const fingerprintOf = (row: ReportRow): PadronDataFingerprint => ({
  targetRows: countOf(row.target_rows),
  targetMaxId: countOf(row.target_max_id),
  stagingCandidates: countOf(row.staging_candidates),
  digest: textOf(row.plan_digest) ?? "",
});

export function toPadronClassification(row: ReportRow): PadronClassification {
  return {
    fingerprint: fingerprintOf(row),
    counts: {
      inserted: countOf(row.new),
      unchanged: countOf(row.unchanged),
      withinTolerance: countOf(row.within_tolerance),
      changed: countOf(row.changed),
      ambiguous: countOf(row.ambiguous),
      missing: countOf(row.missing),
      missingByClass: missingByClassOf(row),
      updates: countOf(row.updates),
      pairs: countOf(row.pairs),
      pairsLoose: countOf(row.pairs_loose),
      pairsTotal: countOf(row.pairs_total),
      pairsPending: countOf(row.pairs_pending),
      pairsNotApplied: countOf(row.pairs_not_applied),
      choicesUnapplied: countOf(row.choices_unapplied),
      geometryPending: countOf(row.geometry_pending),
      geometryAcceptsUnapplied: countOf(row.geometry_accepts_unapplied),
    },
    missingSamples: listOf(row.missing_samples).map(keyOf),
    missingReview: listOf(row.missing_review).map(missingPadronOf),
    ambiguousSamples: listOf(row.ambiguous_samples).map(keyOf),
    geometryChanges: listOf(row.geometry_changes).map(geometryChangeOf),
    pendingGeometryChanges: listOf(row.pending_geometry_changes).map(geometryChangeOf),
    pairs: listOf(row.pairs_list).map(pairOf),
  };
}

/** An analysis writes nothing: its inserted, updated and paired counts are the classification's planned ones, and it has no inserted list. */
export function plannedApplyOf(counts: PadronCounts): PadronApplyOutcome {
  return { inserted: counts.inserted, updated: counts.updates, paired: counts.pairs, insertedList: [] };
}

export function toPadronApplyOutcome(row: ReportRow): PadronApplyOutcome {
  return {
    inserted: countOf(row.inserted),
    updated: countOf(row.updated),
    paired: countOf(row.paired),
    insertedList: listOf(row.inserted_list).map(insertedOf),
  };
}

interface PadronTargetReportInput {
  target: WritableTargetLayout;
  classification: PadronClassification;
  apply: PadronApplyOutcome;
  updateGeometries: boolean;
}

export function buildPadronTargetReport({
  target,
  classification,
  apply,
  updateGeometries,
}: PadronTargetReportInput): ActualizarTargetReport {
  const { counts } = classification;
  return {
    table: buildQualifiedTableLabel(target.schema, target.table),
    schema: target.schema,
    inserted: apply.inserted,
    insertedList: apply.insertedList,
    updated: apply.updated,
    updateApplied: updateGeometries,
    unchanged: counts.unchanged,
    unchangedWithinTolerance: counts.withinTolerance,
    changed: counts.changed,
    missing: counts.missing,
    missingSamples: classification.missingSamples,
    missingByClass: counts.missingByClass,
    missingReview: classification.missingReview,
    ambiguous: counts.ambiguous,
    ambiguousSamples: classification.ambiguousSamples,
    geometryChanges: classification.geometryChanges,
    geometryPending: counts.geometryPending,
    pairs: classification.pairs,
    pairsTotal: counts.pairsTotal,
    pairsApplied: counts.pairs,
    pairsLoose: counts.pairsLoose,
    pairsPending: counts.pairsPending,
    pairsNotApplied: counts.pairsNotApplied,
    choicesUnapplied: counts.choicesUnapplied,
    geometryAcceptsUnapplied: counts.geometryAcceptsUnapplied,
  };
}

