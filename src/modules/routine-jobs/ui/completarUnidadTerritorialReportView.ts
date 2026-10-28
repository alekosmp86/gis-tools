import { buildRefreshViewStatement } from "../jobs/completar-unidad-territorial/domain/refreshSuggestion";
import { COMMIT_UNKNOWN_WARNING, DRY_RUN_WARNING } from "../jobs/completar-unidad-territorial/domain/warnings";
import type { CompletarAmbiguousUnit, CompletarLinkedUnit, CompletarResult } from "../jobs/completar-unidad-territorial/types";
import type { ReportBannerView, TimingItemView } from "./ReportParts";
import { outcomeBannersOf, timingsViewOf, type OutcomeTexts } from "./reportViewParts";
import { reportRowToneOf, type ReportRowTone } from "./reportRowTone";

const OUTCOME_TEXTS: OutcomeTexts = {
  unknown:
    "No se pudo confirmar el COMMIT. Verifique las tablas de unidades territoriales y de direcciones maestras antes de volver a cargar.",
  dryRun: DRY_RUN_WARNING,
  done: "Proceso confirmado: las tablas de unidades territoriales y de direcciones maestras fueron modificadas.",
};
const REFRESH_AFTER_REAL_RUN = "Actualice la vista materializada para que refleje los cambios.";
const REFRESH_AFTER_DRY_RUN = "Después de cargar, actualice la vista materializada para que refleje los cambios.";
const REFRESH_REQUEST = "Si no tiene permiso para hacerlo, pida a quien lo tenga que ejecute:";

export interface CompletarCountRow {
  label: string;
  value: number;
  tone: ReportRowTone;
}

export interface RefreshSuggestionView {
  text: string;
  statement: string;
}

export interface CompletarReportView {
  banners: ReportBannerView[];
  counts: CompletarCountRow[];
  unitTable: string;
  addressMasterTable: string;
  linked: CompletarLinkedUnit[];
  ambiguous: CompletarAmbiguousUnit[];
  suggestion: RefreshSuggestionView | null;
  warnings: string[];
  timings: TimingItemView[];
  totalSeconds: number;
}

const countRowOf = (label: string, value: number, isNeutral = false): CompletarCountRow => ({
  label,
  value,
  tone: reportRowToneOf(value, isNeutral),
});

const countsOf = ({ counts }: CompletarResult): CompletarCountRow[] => [
  countRowOf("Unidades sin dirección maestra", counts.withoutAddressMaster, true),
  countRowOf("Registros creados", counts.created),
  countRowOf("Unidades enlazadas", counts.linked),
  countRowOf("Ya tenían registro", counts.alreadyHadRecord, true),
  countRowOf("Ambiguas", counts.ambiguous),
];

function suggestionOf(result: CompletarResult): RefreshSuggestionView | null {
  const mayModify = result.counts.linked > 0;
  const changed = result.dryRun || result.targetModified || result.outcomeUnknown;
  if (!mayModify || !changed) return null;
  const intro = result.dryRun ? REFRESH_AFTER_DRY_RUN : REFRESH_AFTER_REAL_RUN;
  return { text: `${intro} ${REFRESH_REQUEST}`, statement: buildRefreshViewStatement(result.unitSchema) };
}

export function buildCompletarReportView(result: CompletarResult): CompletarReportView {
  const { timings, totalSeconds } = timingsViewOf(result.stepTimings);
  return {
    banners: outcomeBannersOf({ ...result, modified: result.targetModified }, OUTCOME_TEXTS),
    counts: countsOf(result),
    unitTable: result.unitTable,
    addressMasterTable: result.addressMasterTable,
    linked: result.linkedList,
    ambiguous: result.ambiguousSamples,
    suggestion: suggestionOf(result),
    warnings: result.warnings.filter((warning) => warning !== DRY_RUN_WARNING && warning !== COMMIT_UNKNOWN_WARNING),
    timings,
    totalSeconds,
  };
}
