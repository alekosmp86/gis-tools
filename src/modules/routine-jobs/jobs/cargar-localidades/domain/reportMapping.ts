import { LOCALITY_SKIP_REASON, type LocalitySkipReason } from "../constants";
import type {
  CodeDifference,
  GeometryChange,
  InsertedLocality,
  LocalityKey,
  LocalitySkippedSample,
  SourceReport,
  TargetApplyOutcome,
  TargetClassification,
} from "../types";
import { numberOf, nullableNumber, textOf, listOf, type Row } from "../../shared/rowMapping";

const SKIP_REASONS: readonly LocalitySkipReason[] = Object.values(LOCALITY_SKIP_REASON);

function skippedCountsOf(value: unknown): Record<LocalitySkipReason, number> {
  const counts = (value ?? {}) as Record<string, unknown>;
  return Object.fromEntries(SKIP_REASONS.map((reason) => [reason, numberOf(counts[reason])])) as Record<LocalitySkipReason, number>;
}

const localityKeyOf = (entry: Row): LocalityKey => ({ department: textOf(entry.department), name: textOf(entry.name) });

const skippedSampleOf = (entry: Row): LocalitySkippedSample => ({
  department: textOf(entry.department),
  locality: textOf(entry.locality),
  code: textOf(entry.code),
  reason: String(entry.reason) as LocalitySkipReason,
});

const codeDifferenceOf = (entry: Row): CodeDifference => ({
  ...localityKeyOf(entry),
  code: textOf(entry.code),
  targetCode: textOf(entry.targetCode),
});

const geometryChangeOf = (entry: Row): GeometryChange => ({
  ...localityKeyOf(entry),
  distance: nullableNumber(entry.distance),
  areaRatio: nullableNumber(entry.areaRatio),
});

const insertedLocalityOf = (entry: Row): InsertedLocality => ({
  id: numberOf(entry.id),
  ...localityKeyOf(entry),
});

export function toSourceReport(row: Row): SourceReport {
  const skippedByReason = skippedCountsOf(row.by_reason);
  const skipped = Object.values(skippedByReason).reduce((total, count) => total + count, 0);
  return {
    totals: {
      rowsRead: numberOf(row.rows_read),
      groups: numberOf(row.groups),
      repaired: numberOf(row.repaired),
      candidates: numberOf(row.candidates),
      skipped,
    },
    skippedByReason,
    skippedSamples: listOf(row.samples).map(skippedSampleOf),
  };
}

export function toTargetClassification(row: Row): TargetClassification {
  return {
    counts: {
      inserted: numberOf(row.new),
      unchanged: numberOf(row.unchanged),
      withinTolerance: numberOf(row.within_tolerance),
      changed: numberOf(row.changed),
      ambiguous: numberOf(row.ambiguous),
      missing: numberOf(row.missing),
      codeDiffers: numberOf(row.code_differs),
    },
    missingSamples: listOf(row.missing_samples).map(localityKeyOf),
    ambiguousSamples: listOf(row.ambiguous_samples).map(localityKeyOf),
    codeDiffersSamples: listOf(row.code_differs_samples).map(codeDifferenceOf),
    geometryChanges: listOf(row.geometry_changes).map(geometryChangeOf),
  };
}

export function toTargetApplyOutcome(row: Row): TargetApplyOutcome {
  return {
    inserted: numberOf(row.inserted),
    updated: numberOf(row.updated),
    insertedList: listOf(row.inserted_list).map(insertedLocalityOf),
  };
}
