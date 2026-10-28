import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import { UNIT_SKIP_REASON, type UnitSkipReason } from "../constants";
import type {
  UnitApplyOutcome,
  UnitClassification,
  UnitGeometryChange,
  UnitInserted,
  UnitKey,
  UnitSkippedSample,
  UnitSourceReport,
  UnitTargetReport,
} from "../types";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import { numberOf, nullableNumber, textOf, listOf, type Row } from "../../shared/rowMapping";

const SKIP_REASONS: readonly UnitSkipReason[] = Object.values(UNIT_SKIP_REASON);

function skippedCountsOf(value: unknown): Record<UnitSkipReason, number> {
  const counts = (value ?? {}) as Record<string, unknown>;
  return Object.fromEntries(SKIP_REASONS.map((reason) => [reason, numberOf(counts[reason])])) as Record<UnitSkipReason, number>;
}

const unitKeyOf = (entry: Row): UnitKey => ({ provinceId: textOf(entry.provinceId), name: textOf(entry.name) });

const skippedSampleOf = (entry: Row): UnitSkippedSample => ({
  name: textOf(entry.name),
  provinceId: textOf(entry.province_id),
  reason: String(entry.reason) as UnitSkipReason,
});

const geometryChangeOf = (entry: Row): UnitGeometryChange => ({
  ...unitKeyOf(entry),
  distance: nullableNumber(entry.distance),
  areaRatio: nullableNumber(entry.areaRatio),
});

const insertedOf = (entry: Row): UnitInserted => ({ id: numberOf(entry.id), ...unitKeyOf(entry) });

export function toUnitSourceReport(row: Row): UnitSourceReport {
  const skippedByReason = skippedCountsOf(row.by_reason);
  const skipped = Object.values(skippedByReason).reduce((total, count) => total + count, 0);
  return {
    totals: { rowsRead: numberOf(row.rows_read), candidates: numberOf(row.candidates), skipped },
    skippedByReason,
    skippedSamples: listOf(row.samples).map(skippedSampleOf),
  };
}

export function toUnitClassification(row: Row): UnitClassification {
  return {
    counts: {
      inserted: numberOf(row.new),
      unchanged: numberOf(row.unchanged),
      withinTolerance: numberOf(row.within_tolerance),
      changed: numberOf(row.changed),
      ambiguous: numberOf(row.ambiguous),
      missing: numberOf(row.missing),
      fontDiffers: numberOf(row.font_differs),
      updates: numberOf(row.updates),
    },
    missingSamples: listOf(row.missing_samples).map(unitKeyOf),
    ambiguousSamples: listOf(row.ambiguous_samples).map(unitKeyOf),
    geometryChanges: listOf(row.geometry_changes).map(geometryChangeOf),
  };
}

export function toUnitApplyOutcome(row: Row): UnitApplyOutcome {
  return {
    inserted: numberOf(row.inserted),
    updated: numberOf(row.updated),
    insertedList: listOf(row.inserted_list).map(insertedOf),
  };
}

interface UnitTargetReportInput {
  target: WritableTargetLayout;
  classification: UnitClassification;
  apply: UnitApplyOutcome;
  updateGeometries: boolean;
}

export function buildUnitTargetReport({ target, classification, apply, updateGeometries }: UnitTargetReportInput): UnitTargetReport {
  const { counts } = classification;
  return {
    table: buildQualifiedTableLabel(target.schema, target.table),
    inserted: apply.inserted,
    insertedList: apply.insertedList,
    updated: apply.updated,
    updateApplied: updateGeometries,
    unchanged: counts.unchanged,
    unchangedWithinTolerance: counts.withinTolerance,
    changed: counts.changed,
    fontDiffers: counts.fontDiffers,
    missing: counts.missing,
    missingSamples: classification.missingSamples,
    ambiguous: counts.ambiguous,
    ambiguousSamples: classification.ambiguousSamples,
    geometryChanges: classification.geometryChanges,
  };
}
