import { UNIT_SKIP_REASON, type UnitSkipReason } from "../jobs/unidad-territorial/constants";
import { COMMIT_UNKNOWN_WARNING, DRY_RUN_WARNING } from "../jobs/unidad-territorial/domain/warnings";
import type {
  UnitGeometryChange,
  UnitInserted,
  UnitKey,
  UnitResult,
  UnitSkippedSample,
  UnitTargetReport,
} from "../jobs/unidad-territorial/types";
import type { ReportBannerView, ReportKpiView, SkipReasonView, TimingItemView } from "./ReportParts";

const UNKNOWN_TEXT = "No se pudo confirmar el COMMIT. Verifique la tabla de unidades territoriales antes de volver a cargar.";
const DONE_TEXT = "Actualización confirmada: la tabla de unidades territoriales fue modificada.";
const MS_PER_SECOND = 1000;
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
  timings: TimingItemView[];
  totalSeconds: number;
}

const percentOf = (value: number, total: number): number => (total === 0 ? 0 : Math.round((value * PERCENT_SCALE) / total));

const bannersOf = (result: UnitResult): ReportBannerView[] => {
  const banners: ReportBannerView[] = [];
  if (result.outcomeUnknown) banners.push({ kind: "unknown", text: UNKNOWN_TEXT });
  if (result.dryRun) banners.push({ kind: "dryRun", text: DRY_RUN_WARNING });
  else if (result.targetModified) banners.push({ kind: "done", text: DONE_TEXT });
  return banners;
};

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

const targetViewOf = (target: UnitTargetReport): UnitReportTargetView => ({
  table: target.table,
  counts: [
    { label: "Insertadas", value: target.inserted },
    { label: "Actualizadas", value: target.updated },
    { label: "Geometrías que cambian", value: target.changed },
    { label: "Cambio de fuente", value: target.fontDiffers },
    { label: "Sin cambios", value: target.unchanged },
    { label: "Sin cambios dentro de tolerancia", value: target.unchangedWithinTolerance },
    { label: "Faltantes en origen", value: target.missing },
    { label: "Ambiguas", value: target.ambiguous },
  ],
  notes: targetNotesOf(target),
  inserted: target.insertedList,
  geometryChanges: target.geometryChanges,
  missing: target.missingSamples,
  ambiguous: target.ambiguousSamples,
});

const timingsOf = (result: UnitResult): TimingItemView[] =>
  result.stepTimings.map((timing) => ({ label: timing.label, seconds: timing.ms / MS_PER_SECOND }));

export function buildUnitReportView(result: UnitResult): UnitReportView {
  const timings = timingsOf(result);
  return {
    banners: bannersOf(result),
    kpis: kpisOf(result),
    skippedRows: skipRowsOf(result),
    zeroReasonCount: zeroReasonCountOf(result),
    skippedSamples: result.skipped.samples,
    warnings: result.warnings.filter((warning) => warning !== DRY_RUN_WARNING && warning !== COMMIT_UNKNOWN_WARNING),
    target: targetViewOf(result.target),
    timings,
    totalSeconds: timings.reduce((total, timing) => total + timing.seconds, 0),
  };
}

export const unitSkipReasonLabelOf = (reason: UnitSkipReason): string => REASON_TEXT[reason].label;
