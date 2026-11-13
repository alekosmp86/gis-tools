import { numberOf, type Row } from "../../shared/rowMapping";
import { EJES_SUMMARY_COUNT_KEYS } from "../constants";
import type {
  EjesAnalysis,
  EjesLoadCounts,
  EjesLoadRenumberedRow,
  EjesSkippedRow,
  EjesSummary,
  EjesSurplusRow,
} from "../types";

export interface EjesLoadPlan {
  counts: EjesLoadCounts;
  attr: { idcalle: number; type: number; font: number; geom: number };
  surplusTotal: number;
}

export const toEjesLoadPlan = (row: Row): EjesLoadPlan => ({
  counts: {
    inserted: numberOf(row.inserted),
    updated: numberOf(row.updated),
    renumbered: numberOf(row.renumbered),
    waysCreated: numberOf(row.ways),
    mastersCreated: numberOf(row.inserted),
    pointsMoved: numberOf(row.points_moved),
  },
  attr: { idcalle: numberOf(row.idcalle), type: numberOf(row.type), font: numberOf(row.font), geom: numberOf(row.geom) },
  surplusTotal: numberOf(row.surplus),
});

export const toSurplusRow = (row: Row): EjesSurplusRow => ({
  ref: String(row.ref),
  id: String(row.id),
  points: numberOf(row.points),
});

export const toLoadRenumberedRow = (row: Row): EjesLoadRenumberedRow => ({
  oldRef: String(row.old_ref),
  newRef: String(row.new_ref),
  id: String(row.id),
  points: numberOf(row.points),
});

/** Splits, merges and plain removals are not applied in this slice: they are listed as skipped, with the points their sections hold. */
export function skippedRowsOf(analysis: EjesAnalysis): EjesSkippedRow[] {
  return [
    ...analysis.splits.map((row): EjesSkippedRow => ({ kind: "split", refs: [row.oldRef], idcalle: row.idcalle, points: row.points })),
    ...analysis.merges.map((row): EjesSkippedRow => ({ kind: "merge", refs: row.oldRefs, idcalle: row.idcalle, points: row.points })),
    ...analysis.plainRemovals.map(
      (row): EjesSkippedRow => ({ kind: "removal", refs: [row.ref], idcalle: row.idcalle, points: row.points })
    ),
  ];
}

export function changedSummaryKeys(summary: EjesSummary, counts: EjesAnalysis["counts"]): string[] {
  return EJES_SUMMARY_COUNT_KEYS.filter((key) => summary.counts[key] !== counts[key]);
}
