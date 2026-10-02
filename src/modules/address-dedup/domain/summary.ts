import type { AnalysisRow, DedupSummary } from "../types";

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** The "headline numbers" table (decision x fuente), the count by reason, and the group count. */
export function summarizeRows(rows: ReadonlyArray<AnalysisRow>): DedupSummary {
  const byDecisionAndFuente: Record<string, Record<string, number>> = {};
  const byReason: Record<string, number> = {};
  const groupIds = new Set<number>();

  for (const row of rows) {
    groupIds.add(row.group_id);
    byDecisionAndFuente[row.decision] ??= {};
    increment(byDecisionAndFuente[row.decision], row.fuente);
    increment(byReason, row.decision_reason);
  }

  return {
    groupCount: groupIds.size,
    rowCount: rows.length,
    byDecisionAndFuente,
    byReason,
  };
}
