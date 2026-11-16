import { numberOf, type Row } from "../../shared/rowMapping";
import { EJES_SUMMARY_COUNT_KEYS } from "../constants";
import type {
  EjesAnalysis,
  EjesFingerprint,
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
    renumberSkipped: numberOf(row.renumber_skipped),
    waysCreated: numberOf(row.ways),
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

/** Splits, merges, plain removals and renumbers the analysis skipped are not applied in this slice: they are listed as skipped, with the points their sections hold. */
export function skippedRowsOf(analysis: EjesAnalysis): EjesSkippedRow[] {
  return [
    ...analysis.splits.map((row): EjesSkippedRow => ({ kind: "split", refs: [row.oldRef], idcalle: row.idcalle, points: row.points })),
    ...analysis.merges.map((row): EjesSkippedRow => ({ kind: "merge", refs: row.oldRefs, idcalle: row.idcalle, points: row.points })),
    ...analysis.plainRemovals.map(
      (row): EjesSkippedRow => ({ kind: "removal", refs: [row.ref], idcalle: row.idcalle, points: row.points })
    ),
    ...analysis.renumberSkipped.map(
      (row): EjesSkippedRow => ({ kind: "renumber", refs: [row.oldRef, row.newRef], idcalle: row.idcalle, points: row.points, reason: row.reason })
    ),
  ];
}

/** The summary the real run sends back: the Revisar counts and the staging fingerprint of the dry-run result. */
export const summaryOf = (analysis: EjesAnalysis): EjesSummary => ({
  counts: Object.fromEntries(EJES_SUMMARY_COUNT_KEYS.map((key) => [key, analysis.counts[key]])) as EjesSummary["counts"],
  fingerprint: analysis.fingerprint,
});

export function changedSummaryKeys(summary: EjesSummary, counts: EjesAnalysis["counts"]): string[] {
  return EJES_SUMMARY_COUNT_KEYS.filter((key) => summary.counts[key] !== counts[key]);
}

export const fingerprintChanged = (summary: EjesSummary, fingerprint: EjesFingerprint): boolean =>
  summary.fingerprint.rows !== fingerprint.rows || summary.fingerprint.digest !== fingerprint.digest;
