import { REMOVAL_SKIP_REASON, type RemovalSkipReason } from "../jobs/actualizar-padron/constants";
import type { ActualizarTargetReport, PadronRemoved } from "../jobs/actualizar-padron/types";
import type { ReportRowListRow } from "./ReportRowList";
import { listSummaryOf } from "./reportViewParts";

const HEADLINE_PLANNED = "Padrones que se eliminarán";
const HEADLINE_DONE = "Padrones eliminados";
const HEADLINE_SUFFIX = "sin direcciones asociadas";
const STATUS_PLANNED = "Se eliminará";
const STATUS_DONE = "Eliminada";
const NOT_REMOVED_PREFIX_PLANNED = "No se elimina";
const NOT_REMOVED_PREFIX_DONE = "No eliminada";

const NOT_REMOVED_REASON_TEXT: Record<RemovalSkipReason, string> = {
  [REMOVAL_SKIP_REASON.NOW_REFERENCED]: "tiene direcciones asociadas",
  [REMOVAL_SKIP_REASON.STILL_PAIRABLE]: "tiene un par sin resolver",
  [REMOVAL_SKIP_REASON.UNVERIFIED]: "no se pudieron verificar sus referencias",
};

const NOT_REMOVED_ORDER: readonly RemovalSkipReason[] = [
  REMOVAL_SKIP_REASON.NOW_REFERENCED,
  REMOVAL_SKIP_REASON.STILL_PAIRABLE,
  REMOVAL_SKIP_REASON.UNVERIFIED,
];

export interface RemovalView {
  headline: string;
  /** The padrones that are not deleted, one row per reason that applies. */
  notRemoved: ReportRowListRow[];
  blockedReason: string | null;
  listSummary: string;
  rows: PadronRemoved[];
  statusLabel: string;
}

/** AP-108: the removal section of the review (an analysis) and of the result (a real run). Null when nothing is removed or held back. */
export function removalViewOf(target: ActualizarTargetReport, dryRun: boolean): RemovalView | null {
  const removed = target.removed ?? 0;
  const skipped = target.removalsSkipped;
  const blockedReason = target.removalBlockedReason ?? null;
  if (removed === 0 && (skipped?.total ?? 0) === 0 && blockedReason === null) return null;
  const headline = dryRun ? HEADLINE_PLANNED : HEADLINE_DONE;
  const prefix = dryRun ? NOT_REMOVED_PREFIX_PLANNED : NOT_REMOVED_PREFIX_DONE;
  const rows = target.removedList ?? [];
  return {
    headline: `${headline}: ${removed} (${HEADLINE_SUFFIX})`,
    notRemoved: NOT_REMOVED_ORDER.filter((reason) => (skipped?.byReason[reason] ?? 0) > 0).map((reason) => ({
      label: `${prefix}: ${NOT_REMOVED_REASON_TEXT[reason]}`,
      value: skipped?.byReason[reason] ?? 0,
    })),
    blockedReason,
    listSummary: listSummaryOf(headline, rows.length, removed),
    rows,
    statusLabel: dryRun ? STATUS_PLANNED : STATUS_DONE,
  };
}
