import { buildRefreshMaterializedViewStatement } from "../jobs/shared/refreshSuggestion";
import { TERRITORIAL_UNIT_VIEW_NAME, UNIT_SKIP_REASON, type UnitSkipReason } from "../jobs/unidad-territorial/constants";
import { COMMIT_UNKNOWN_WARNING, DRY_RUN_WARNING } from "../jobs/unidad-territorial/domain/warnings";
import type {
  UnitGeometryChange,
  UnitInserted,
  UnitKey,
  UnitResult,
  UnitSkippedSample,
  UnitTargetReport,
} from "../jobs/unidad-territorial/types";
import { addressMasterViewOf, type AddressMasterView } from "./addressMasterReportView";
import { UNIT_ADDRESS_MASTER_TEXTS } from "./addressMasterSubjectTexts";
import type { ReportBannerView, ReportKpiView, SkipReasonView, TimingItemView } from "./ReportParts";
import { outcomeBannersOf, timingsViewOf, type OutcomeTexts } from "./reportViewParts";
import { reportRowToneOf, type ReportRowTone } from "./reportRowTone";
import type { RefreshSuggestionView } from "./refreshSuggestionView";

const OUTCOME_TEXTS: OutcomeTexts = {
  unknown: "No se pudo confirmar el COMMIT. Verifique la tabla de unidades territoriales antes de volver a cargar.",
  dryRun: DRY_RUN_WARNING,
  done: "Actualización confirmada: la tabla de unidades territoriales fue modificada.",
};
const LINKED_OUTCOME_TEXTS: OutcomeTexts = {
  unknown:
    "No se pudo confirmar el COMMIT. Verifique las tablas de unidades territoriales y de direcciones maestras antes de volver a cargar.",
  dryRun: DRY_RUN_WARNING,
  done: "Actualización confirmada: las tablas de unidades territoriales y de direcciones maestras fueron modificadas.",
};
const REFRESH_SUGGESTION_TEXT =
  "Actualice la vista materializada para que refleje los cambios. Si no tiene permiso para hacerlo, pida a quien lo tenga que ejecute:";
const PERCENT_SCALE = 100;

const REASON_TEXT: Record<UnitSkipReason, { label: string; explanation: string }> = {
  [UNIT_SKIP_REASON.NOMBRE_NULO]: {
    label: "Nombre nulo",
    explanation: "La localidad de origen no tiene nombre.",
  },
  [UNIT_SKIP_REASON.PROVINCIA_NULA]: {
    label: "Provincia nula",
    explanation: "La localidad de origen no tiene provincia.",
  },
  [UNIT_SKIP_REASON.FUENTE_NULA]: {
    label: "Fuente nula",
    explanation: "La localidad de origen no tiene tipo de fuente, y la unidad necesita una fuente.",
  },
  [UNIT_SKIP_REASON.SIN_GEOMETRIA]: {
    label: "Sin geometría",
    explanation: "La localidad de origen no tiene geometría utilizable.",
  },
  [UNIT_SKIP_REASON.CLAVE_DUPLICADA]: {
    label: "Clave duplicada",
    explanation: "Una misma provincia y nombre aparecen más de una vez en origen: ninguna de esas filas se aplica.",
  },
};

const SKIP_REASONS: readonly UnitSkipReason[] = Object.values(UNIT_SKIP_REASON);

export interface UnitReportCountRow {
  label: string;
  value: number;
  tone: ReportRowTone;
}

export interface UnitReportTargetView {
  table: string;
  counts: UnitReportCountRow[];
  notes: string[];
  inserted: UnitInserted[];
  geometryChanges: UnitGeometryChange[];
  missing: UnitKey[];
  ambiguous: UnitKey[];
}

export interface UnitReportView {
  banners: ReportBannerView[];
  kpis: ReportKpiView[];
  skippedRows: SkipReasonView[];
  zeroReasonCount: number;
  skippedSamples: UnitSkippedSample[];
  warnings: string[];
  target: UnitReportTargetView;
  addressMaster: AddressMasterView | null;
  suggestion: RefreshSuggestionView | null;
  timings: TimingItemView[];
  totalSeconds: number;
}

const percentOf = (value: number, total: number): number => (total === 0 ? 0 : Math.round((value * PERCENT_SCALE) / total));

const kpisOf = (result: UnitResult): ReportKpiView[] => [
  { label: "Filas leídas", value: result.totals.rowsRead },
  { label: "Candidatas", value: result.totals.candidates },
  { label: "Omitidas", value: result.totals.skipped },
  { label: "Insertadas", value: result.target.inserted },
  { label: "Actualizadas", value: result.target.updated },
  { label: "Geometrías que cambian", value: result.target.changed },
];

const skipRowsOf = (result: UnitResult): SkipReasonView[] => {
  const denominator = result.totals.candidates + result.totals.skipped;
  return SKIP_REASONS.map((reason) => {
    const value = result.skipped[reason];
    return {
      reason,
      label: REASON_TEXT[reason].label,
      explanation: REASON_TEXT[reason].explanation,
      value,
      percent: percentOf(value, denominator),
    };
  }).filter((row) => row.value > 0);
};

const zeroReasonCountOf = (result: UnitResult): number =>
  SKIP_REASONS.filter((reason) => result.skipped[reason] === 0).length;

const targetNotesOf = (target: UnitTargetReport): string[] =>
  target.changed > 0 && !target.updateApplied
    ? [`Las geometrías que cambian no se aplicaron en ${target.table} (Actualizar geometrías desactivado).`]
    : [];

const countRowOf = (label: string, value: number, isNeutral = false): UnitReportCountRow => ({
  label,
  value,
  tone: reportRowToneOf(value, isNeutral),
});

const targetViewOf = (target: UnitTargetReport): UnitReportTargetView => ({
  table: target.table,
  counts: [
    countRowOf("Insertadas", target.inserted),
    countRowOf("Actualizadas", target.updated),
    countRowOf("Geometrías que cambian", target.changed),
    countRowOf("Cambio de fuente", target.fontDiffers),
    countRowOf("Sin cambios", target.unchanged, true),
    countRowOf("Sin cambios dentro de tolerancia", target.unchangedWithinTolerance, true),
    countRowOf("Faltantes en origen", target.missing),
    countRowOf("Ambiguas", target.ambiguous),
  ],
  notes: targetNotesOf(target),
  inserted: target.insertedList,
  geometryChanges: target.geometryChanges,
  missing: target.missingSamples,
  ambiguous: target.ambiguousSamples,
});

const addressMasterChangesOf = (result: UnitResult): number =>
  result.addressMaster === undefined ? 0 : result.addressMaster.counts.created + result.addressMaster.counts.linked;

/** The view reads units and address masters, so any changed row makes it stale: inserts, source or geometry updates, links. */
const changedRowsOf = (result: UnitResult): number => result.target.inserted + result.target.updated + addressMasterChangesOf(result);

function suggestionOf(result: UnitResult, targetSchema: string | undefined): RefreshSuggestionView | null {
  const changed = result.targetModified || result.outcomeUnknown;
  if (result.dryRun || targetSchema === undefined || changedRowsOf(result) === 0 || !changed) return null;
  return {
    text: REFRESH_SUGGESTION_TEXT,
    statement: buildRefreshMaterializedViewStatement(targetSchema, TERRITORIAL_UNIT_VIEW_NAME),
  };
}

export function buildUnitReportView(result: UnitResult, targetSchema: string | undefined): UnitReportView {
  const { timings, totalSeconds } = timingsViewOf(result.stepTimings);
  const outcomeTexts = result.addressMaster === undefined ? OUTCOME_TEXTS : LINKED_OUTCOME_TEXTS;
  return {
    banners: outcomeBannersOf({ ...result, modified: result.targetModified }, outcomeTexts),
    kpis: kpisOf(result),
    skippedRows: skipRowsOf(result),
    zeroReasonCount: zeroReasonCountOf(result),
    skippedSamples: result.skipped.samples,
    warnings: result.warnings.filter((warning) => warning !== DRY_RUN_WARNING && warning !== COMMIT_UNKNOWN_WARNING),
    target: targetViewOf(result.target),
    addressMaster: result.addressMaster === undefined ? null : addressMasterViewOf(result.addressMaster, UNIT_ADDRESS_MASTER_TEXTS),
    suggestion: suggestionOf(result, targetSchema),
    timings,
    totalSeconds,
  };
}

export const unitSkipReasonLabelOf = (reason: UnitSkipReason): string => REASON_TEXT[reason].label;
