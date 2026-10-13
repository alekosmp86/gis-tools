import type { IndicatorsPlan, LoadResult, RejectedRow } from "../client";

/** Pure view helpers over the plan and result payloads. */

export interface RejectedFileGroup {
  readonly file: string;
  readonly rows: ReadonlyArray<RejectedRow>;
}

export function collectRejectedRows(plan: IndicatorsPlan): RejectedRow[] {
  return plan.cuts.flatMap((cut) => cut.rejectedRows);
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

/** Blockers not already shown as file errors (missing privileges, nothing to load). */
export function listOtherBlockers(plan: IndicatorsPlan): string[] {
  const fileErrorMessages = new Set(plan.fileErrors.map((error) => error.message));
  return plan.blockers.filter((blocker) => !fileErrorMessages.has(blocker));
}

/** The "corte incompleto" message of every loaded cut that lost rows. */
export function listIncompleteMessages(result: LoadResult): string[] {
  return result.cuts.flatMap((cut) => (cut.incompleteMessage ? [cut.incompleteMessage] : []));
}
