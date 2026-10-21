import type { AvancePlan, RejectedRow, StatusCount } from "../client";

/** Pure view helpers over the plan payload. */

export interface RejectedFileGroup {
  readonly file: string;
  readonly rows: ReadonlyArray<RejectedRow>;
}

export interface StatusRow {
  readonly status: string;
  readonly zones: number;
  readonly currentAvanceRows: number;
  readonly isExcluded: boolean;
}

const NO_STATUS_LABEL = "(sin estado)";
const EMPTY_STATUS = "";

export function collectRejectedRows(plan: AvancePlan): RejectedRow[] {
  return plan.files.flatMap((file) => file.rejectedRows);
}

/** Groups by file, keeping the order in which files first appear. */
export function groupRejectedByFile(rows: ReadonlyArray<RejectedRow>): RejectedFileGroup[] {
  const rowsByFile = new Map<string, RejectedRow[]>();
  for (const row of rows) {
    const fileRows = rowsByFile.get(row.file);
    if (fileRows) fileRows.push(row);
    else rowsByFile.set(row.file, [row]);
  }
  return [...rowsByFile.entries()].map(([file, fileRows]) => ({ file, rows: fileRows }));
}

/** Blockers not already shown as file errors (missing privileges, empty zones, files without rows). */
export function listOtherBlockers(plan: AvancePlan): string[] {
  const fileErrorMessages = new Set(plan.fileErrors.map((error) => error.message));
  return plan.blockers.filter((blocker) => !fileErrorMessages.has(blocker));
}

export function labelStatus(status: string): string {
  return status === EMPTY_STATUS ? NO_STATUS_LABEL : status;
}

function toCountMap(counts: ReadonlyArray<StatusCount>): Map<string, number> {
  return new Map(counts.map((entry) => [entry.status, entry.count]));
}

/** One row per district status seen in the zones layer or among the current Avance rows. */
export function buildStatusRows(plan: AvancePlan): StatusRow[] {
  const statuses = new Set([...plan.zoneStatuses, ...plan.avanceByStatus].map((entry) => entry.status));
  const excluded = new Set(plan.excludedStatuses);
  const zoneCounts = toCountMap(plan.zoneStatuses);
  const avanceCounts = toCountMap(plan.avanceByStatus);
  return [...statuses]
    .sort((left, right) => left.localeCompare(right))
    .map((status) => ({
      status,
      zones: zoneCounts.get(status) ?? 0,
      currentAvanceRows: avanceCounts.get(status) ?? 0,
      isExcluded: excluded.has(status),
    }));
}

/** Collapsed-header text for the warnings group; empty when there is nothing to show. */
export function warningsHeadline(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "";
  return count === 1 ? "1 advertencia" : `${count} advertencias`;
}
