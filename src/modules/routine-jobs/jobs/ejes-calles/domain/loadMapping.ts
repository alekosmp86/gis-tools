import { numberOf, textOf, type Row } from "../../shared/rowMapping";
import { EJES_STALE_GUARD_KEYS, EJES_SUMMARY_COUNT_KEYS, type EjesSkipKind, type EjesSkipReason } from "../constants";
import type {
  EjesAccepted,
  EjesAnalysis,
  EjesFingerprint,
  EjesLoadCounts,
  EjesLoadRenumberedRow,
  EjesSkipCount,
  EjesSkippedRow,
  EjesSummary,
  EjesSurplusRow,
} from "../types";

export const NO_ACCEPTED: EjesAccepted = {
  splits: [],
  plainRemovals: [],
  merges: [],
  twinRemovals: [],
  twinPicks: [],
  manualSplits: [],
  autoPlainRemovals: false,
};

export interface EjesLoadPlan {
  counts: EjesLoadCounts;
  attr: { idcalle: number; type: number; font: number; geom: number };
  surplusTotal: number;
  deletedMasters: number;
  /** The points the renumbered and merged sections move: by `reftramo`, before the split points. */
  movedPoints: number;
  /** The points of the applied splits, each moved to its own piece. */
  splitPoints: number;
}

export const toEjesLoadPlan = (row: Row): EjesLoadPlan => {
  const movedPoints = numberOf(row.points_moved);
  const splitPoints = numberOf(row.split_points);
  return {
    counts: {
      inserted: numberOf(row.inserted),
      updated: numberOf(row.updated),
      renumbered: numberOf(row.renumbered),
      renumberSkipped: numberOf(row.renumber_skipped),
      removed: numberOf(row.removed),
      merged: numberOf(row.merged),
      splitsApplied: numberOf(row.splits),
      deleted: numberOf(row.deleted),
      waysCreated: numberOf(row.ways),
      pointsMoved: movedPoints + splitPoints,
      topologyAssigned: 0,
      verticesCreated: 0,
      verticesDeleted: 0,
      twinsRemoved: numberOf(row.twins_removed),
    },
    attr: { idcalle: numberOf(row.idcalle), type: numberOf(row.type), font: numberOf(row.font), geom: numberOf(row.geom) },
    surplusTotal: numberOf(row.surplus),
    deletedMasters: numberOf(row.masters_deleted),
    movedPoints,
    splitPoints,
  };
};

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

const listOfCsv = (value: unknown): string[] => {
  const text = textOf(value);
  return text === null || text === "" ? [] : text.split(",");
};

/** One skipped row of the load. Its refs and new refs come comma-joined from the skipped table. */
export const toSkippedRow = (row: Row): EjesSkippedRow => ({
  kind: String(row.kind) as EjesSkipKind,
  refs: listOfCsv(row.refs),
  newRefs: listOfCsv(row.new_refs),
  idcalle: textOf(row.idcalle),
  points: numberOf(row.points),
  reason: String(row.reason) as EjesSkipReason,
});

export const toSkipCount = (row: Row): EjesSkipCount => ({
  reason: String(row.reason) as EjesSkipReason,
  count: numberOf(row.count),
});

/** The summary the real run sends back: the Revisar counts and the staging fingerprint of the dry-run result. */
export const summaryOf = (analysis: EjesAnalysis): EjesSummary => ({
  counts: Object.fromEntries(EJES_SUMMARY_COUNT_KEYS.map((key) => [key, analysis.counts[key]])) as EjesSummary["counts"],
  fingerprint: analysis.fingerprint,
});

export function changedSummaryKeys(summary: EjesSummary, counts: EjesAnalysis["counts"]): string[] {
  return EJES_STALE_GUARD_KEYS.filter((key) => summary.counts[key] !== counts[key]);
}

export const fingerprintChanged = (summary: EjesSummary, fingerprint: EjesFingerprint): boolean =>
  summary.fingerprint.rows !== fingerprint.rows || summary.fingerprint.digest !== fingerprint.digest;
