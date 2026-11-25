import type { EjesBackup, EjesLoadReport, EjesResult, EjesSkippedRow, EjesSurplusRow } from "../../jobs/ejes-ide/types";
import {
  EJES_LOAD_COUNT_TEXT,
  EJES_LOAD_DONE_BANNER,
  EJES_LOAD_UNKNOWN_BANNER,
  EJES_SKIP_KIND_TEXT,
  SKIP_REASON_TEXT,
} from "./ejesLoadTexts";
import type { ReportBannerView } from "../shared/ReportParts";
import type { ReportRowListRow } from "../shared/ReportRowList";
import type { RefreshSuggestionView } from "../shared/refreshSuggestionView";

export interface EjesSkippedView {
  key: string;
  kind: string;
  refs: string;
  newRefs: string;
  idcalle: string;
  points: string;
  reason: string;
}

interface EjesLoadView {
  banners: ReportBannerView[];
  commitError: string | null;
  counts: ReportRowListRow[];
  skipped: EjesSkippedView[];
  skippedTotal: number;
  skippedByReason: ReportRowListRow[];
  surplus: EjesSurplusRow[];
  surplusTotal: number;
  backup: EjesBackup | null;
  nextStep: RefreshSuggestionView | null;
}

const bannersOf = (result: EjesResult): ReportBannerView[] => {
  if (result.outcomeUnknown) return [{ kind: "unknown", text: EJES_LOAD_UNKNOWN_BANNER }];
  if (result.targetModified) return [{ kind: "done", text: EJES_LOAD_DONE_BANNER }];
  return [];
};

const countRowsOf = (load: EjesLoadReport): ReportRowListRow[] => [
  { label: "Tramos insertados", value: load.counts.inserted },
  { label: "Tramos actualizados", value: load.counts.updated },
  { label: "Tramos renumerados", value: load.counts.renumbered },
  { label: "Renumerados retenidos", value: load.counts.renumberSkipped },
  { label: "Divisiones y reemplazos aplicados", value: load.counts.splitsApplied },
  { label: "Uniones aplicadas", value: load.counts.merged },
  { label: "Tramos quitados", value: load.counts.removed },
  { label: "Gemelos quitados", value: load.counts.twinsRemoved },
  { label: "Tramos borrados (divididos o reemplazados, unidos, gemelos y quitados)", value: load.counts.deleted },
  { label: "Vías de circulación creadas", value: load.counts.waysCreated },
  { label: "Vías de circulación renombradas", value: load.counts.waysRenamed },
  { label: "Puntos de acceso movidos", value: load.counts.pointsMoved },
  { label: EJES_LOAD_COUNT_TEXT.TOPOLOGY_ASSIGNED, value: load.counts.topologyAssigned },
  { label: EJES_LOAD_COUNT_TEXT.VERTICES_CREATED, value: load.counts.verticesCreated },
  { label: EJES_LOAD_COUNT_TEXT.VERTICES_DELETED, value: load.counts.verticesDeleted },
];

const skippedViewOf = (row: EjesSkippedRow, index: number): EjesSkippedView => ({
  key: `${index}-${row.kind}`,
  kind: EJES_SKIP_KIND_TEXT[row.kind],
  refs: row.refs.join(" / "),
  newRefs: row.newRefs.join(" / "),
  idcalle: row.idcalle ?? "sin dato",
  points: String(row.points),
  reason: row.reason === undefined ? "" : SKIP_REASON_TEXT[row.reason],
});

/** The real run's result block: what the load wrote, what it held back, the backup and the next step. */
export function buildEjesLoadView(result: EjesResult, load: EjesLoadReport): EjesLoadView {
  return {
    banners: bannersOf(result),
    commitError: result.commitError ?? null,
    counts: countRowsOf(load),
    skipped: load.skipped.map(skippedViewOf),
    skippedTotal: load.skippedTotal,
    skippedByReason: load.skippedByReason.map((entry) => ({ label: SKIP_REASON_TEXT[entry.reason], value: entry.count })),
    surplus: load.surplus,
    surplusTotal: load.surplusTotal,
    backup: load.backup ?? null,
    nextStep: result.nextStep ?? null,
  };
}
