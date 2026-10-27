import { COLLIDING_KEY_LIMIT, SKIP_REASON, SKIPPED_GROUP_LIMIT, SKIPPED_SAMPLE_LIMIT, type SkipReason } from "../constants";
import type { CollidingKey, SkippedGroup, SkippedReport, SkippedSample } from "../types";

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

const toSkippedSamples = (value: unknown): SkippedSample[] =>
  rowsOf(value)
    .slice(0, SKIPPED_SAMPLE_LIMIT)
    .map((row) => ({
      department: textOf(row.department),
      locality: textOf(row.locality),
      padron: textOf(row.padron),
      reason: textOf(row.reason) ?? "",
    }));

const toCollidingKeys = (value: unknown): CollidingKey[] =>
  rowsOf(value)
    .slice(0, COLLIDING_KEY_LIMIT)
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
      samples: toSkippedSamples(report.samples),
      collidingKeys: toCollidingKeys(report.collidingKeyList),
      collidingKeyCount: totals.collidingKeys,
    },
  };
}
