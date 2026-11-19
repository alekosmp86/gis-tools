import { RENUMBER_SKIP_REASON, type RenumberSkipReason } from "../../jobs/ejes-calles/constants";
import type { EjesRenumberSkippedRow } from "../../jobs/ejes-calles/types";

/** A held renumber as listed: one row per old `reftramo` that has several candidates (all in `newRefs`), else one row per pair. */
export interface EjesHeldRenumberView {
  oldRef: string;
  newRefs: string[];
  idcalle: string | null;
  points: number;
  reason: RenumberSkipReason;
}

const viewOf = (row: EjesRenumberSkippedRow): EjesHeldRenumberView => ({
  oldRef: row.oldRef,
  newRefs: [row.newRef],
  idcalle: row.idcalle,
  points: row.points,
  reason: row.reason,
});

export const heldRenumberViewsOf = (rows: readonly EjesRenumberSkippedRow[]): EjesHeldRenumberView[] => {
  const views: EjesHeldRenumberView[] = [];
  const candidateViews = new Map<string, EjesHeldRenumberView>();
  for (const row of rows) {
    if (row.reason !== RENUMBER_SKIP_REASON.AMBIGUOUS_OLD_REF) {
      views.push(viewOf(row));
      continue;
    }
    const existing = candidateViews.get(row.oldRef);
    if (existing === undefined) {
      const view = viewOf(row);
      candidateViews.set(row.oldRef, view);
      views.push(view);
    } else {
      existing.newRefs.push(row.newRef);
    }
  }
  return views;
};

export const heldRenumberKeyOf = (view: EjesHeldRenumberView): string => `${view.oldRef}|${view.newRefs.join(",")}|${view.reason}`;
