import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import { DETAIL_LIST_LIMIT, SAMPLE_LIMIT } from "../../shared/limits";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import {
  LOCALITY_REASON_GROUP_LIMIT,
  PAIR_CHANGE,
  SKIP_REASON,
  SKIPPED_GROUP_LIMIT,
  type PairChange,
  type PairStatus,
  type SkipReason,
} from "../constants";
import type {
  ActualizarTargetReport,
  CollidingKey,
  PadronApplyOutcome,
  PadronClassification,
  PadronGeometryChange,
  PadronInserted,
  PadronKey,
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

const geometryChangeOf = (entry: ReportRow): PadronGeometryChange => ({
  ...namedKeyOf(entry),
  distance: numberOf(entry.distance),
  areaRatio: numberOf(entry.areaRatio),
});

const listOf = (value: unknown): ReportRow[] => rowsOf(value);

const PAIR_CHANGE_FLAGS: ReadonlyArray<readonly [string, PairChange]> = [
  ["typeChanged", PAIR_CHANGE.TYPE],
  ["localityChanged", PAIR_CHANGE.LOCALITY],
  ["numberChanged", PAIR_CHANGE.NUMBER],
];

const pairChangesOf = (entry: ReportRow): PairChange[] =>
  PAIR_CHANGE_FLAGS.filter(([flag]) => entry[flag] === true).map(([, change]) => change);

const pairOf = (entry: ReportRow): PadronPair => ({
  status: entry.status as PairStatus,
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
  distance: numberOf(entry.distance),
});

export function toPadronClassification(row: ReportRow): PadronClassification {
  return {
    counts: {
      inserted: countOf(row.new),
      unchanged: countOf(row.unchanged),
      withinTolerance: countOf(row.within_tolerance),
      changed: countOf(row.changed),
      ambiguous: countOf(row.ambiguous),
      missing: countOf(row.missing),
      updates: countOf(row.updates),
      pairs: countOf(row.pairs),
      pairsTotal: countOf(row.pairs_total),
      pairsNotApplied: countOf(row.pairs_not_applied),
    },
    missingSamples: listOf(row.missing_samples).map(keyOf),
    ambiguousSamples: listOf(row.ambiguous_samples).map(keyOf),
    geometryChanges: listOf(row.geometry_changes).map(geometryChangeOf),
    pairs: listOf(row.pairs_list).map(pairOf),
  };
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
    ambiguous: counts.ambiguous,
    ambiguousSamples: classification.ambiguousSamples,
    geometryChanges: classification.geometryChanges,
    pairs: classification.pairs,
    pairsTotal: counts.pairsTotal,
    pairsApplied: counts.pairs,
    pairsNotApplied: counts.pairsNotApplied,
  };
}

