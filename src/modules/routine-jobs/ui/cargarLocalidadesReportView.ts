import { LOCALITY_SKIP_REASON, type LocalitySkipReason } from "../jobs/cargar-localidades/constants";
import { COMMIT_UNKNOWN_WARNING, DRY_RUN_WARNING } from "../jobs/cargar-localidades/domain/warnings";
import type {
  CargarLocalidadesResult,
  CodeDifference,
  GeometryChange,
  InsertedLocality,
  LocalityKey,
  LocalitySkippedSample,
  TargetReport,
} from "../jobs/cargar-localidades/types";

const ReportBannerKind = {
  UNKNOWN: "unknown",
  DRY_RUN: "dryRun",
  DONE: "done",
} as const;

type ReportBannerKind = (typeof ReportBannerKind)[keyof typeof ReportBannerKind];

interface ReportBanner {
  kind: ReportBannerKind;
  text: string;
}

interface ReportKpi {
  label: string;
  value: number;
}

interface SkipReasonRow {
  reason: LocalitySkipReason;
  label: string;
  explanation: string;
  value: number;
  percent: number;
}

interface CountRow {
  label: string;
  value: number;
}

export interface TargetView {
  table: string;
  counts: CountRow[];
  notes: string[];
  inserted: InsertedLocality[];
  geometryChanges: GeometryChange[];
  missing: LocalityKey[];
  ambiguous: LocalityKey[];
  codeDiffers: CodeDifference[];
}

interface TimingView {
  label: string;
  seconds: number;
}

interface CargarLocalidadesReportView {
  banners: ReportBanner[];
  kpis: ReportKpi[];
  skippedRows: SkipReasonRow[];
  zeroReasonCount: number;
  skippedSamples: LocalitySkippedSample[];
  warnings: string[];
  targets: TargetView[];
  timings: TimingView[];
  totalSeconds: number;
}

const MS_PER_SECOND = 1000;
const PERCENT_SCALE = 100;
const UNKNOWN_TEXT = "No se pudo confirmar el COMMIT. Verifique las dos tablas de localidades antes de volver a cargar.";
const DONE_TEXT = "Carga confirmada: las tablas de localidades fueron modificadas.";

const REASON_TEXT: Record<LocalitySkipReason, { label: string; explanation: string }> = {
  [LOCALITY_SKIP_REASON.SIN_GEOMETRIA]: {
    label: "Sin geometría",
    explanation: "La localidad de origen no tiene geometría utilizable.",
  },
  [LOCALITY_SKIP_REASON.PROVINCIA_NO_ENCONTRADA]: {
    label: "Provincia no encontrada",
    explanation: "El nombre de la provincia del padrón no existe en la tabla de provincias.",
  },
  [LOCALITY_SKIP_REASON.PROVINCIA_AMBIGUA]: {
    label: "Provincia ambigua",
    explanation: "El nombre de la provincia coincide con más de una fila de la tabla de provincias.",
  },
  [LOCALITY_SKIP_REASON.CODIGO_NULO]: {
    label: "Código nulo",
    explanation: "La localidad de origen no tiene código.",
  },
  [LOCALITY_SKIP_REASON.CLAVE_DUPLICADA]: {
    label: "Clave duplicada",
    explanation: "Una misma provincia y nombre aparecen con códigos o geometrías distintos: ninguna de esas filas se carga.",
  },
};

const SKIP_REASONS: readonly LocalitySkipReason[] = Object.values(LOCALITY_SKIP_REASON);

export const skipReasonLabelOf = (reason: LocalitySkipReason): string => REASON_TEXT[reason].label;

const percentOf = (value: number, total: number): number => (total === 0 ? 0 : Math.round((value * PERCENT_SCALE) / total));

const reportBannersOf = (result: CargarLocalidadesResult): ReportBanner[] => {
  const banners: ReportBanner[] = [];
  if (result.outcomeUnknown) banners.push({ kind: ReportBannerKind.UNKNOWN, text: UNKNOWN_TEXT });
  if (result.dryRun) banners.push({ kind: ReportBannerKind.DRY_RUN, text: DRY_RUN_WARNING });
  else if (result.targetsModified) banners.push({ kind: ReportBannerKind.DONE, text: DONE_TEXT });
  return banners;
};

const sumChanged = (targets: readonly TargetReport[]): number => targets.reduce((total, target) => total + target.changed, 0);

const kpisOf = (result: CargarLocalidadesResult): ReportKpi[] => [
  { label: "Filas leídas", value: result.totals.rowsRead },
  { label: "Candidatas", value: result.totals.candidates },
  { label: "Omitidas", value: result.totals.skipped },
  { label: "Geometrías que cambian", value: sumChanged(result.targets) },
];

const skipRowsOf = (result: CargarLocalidadesResult): SkipReasonRow[] => {
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

const zeroReasonCountOf = (result: CargarLocalidadesResult): number =>
  SKIP_REASONS.filter((reason) => result.skipped[reason] === 0).length;

const targetNotesOf = (target: TargetReport): string[] =>
  target.changed > 0 && !target.updateApplied
    ? [`Las geometrías que cambian no se aplicaron en ${target.table} (Actualizar geometrías desactivado).`]
    : [];

const targetViewOf = (target: TargetReport): TargetView => ({
  table: target.table,
  counts: [
    { label: "Insertadas", value: target.inserted },
    { label: "Actualizadas", value: target.updated },
    { label: "Geometrías que cambian", value: target.changed },
    { label: "Sin cambios", value: target.unchanged },
    { label: "Sin cambios dentro de tolerancia", value: target.unchangedWithinTolerance },
    { label: "Faltantes en origen", value: target.missing },
    { label: "Ambiguas", value: target.ambiguous },
    { label: "Código distinto", value: target.codeDiffers },
  ],
  notes: targetNotesOf(target),
  inserted: target.insertedList,
  geometryChanges: target.geometryChanges,
  missing: target.missingSamples,
  ambiguous: target.ambiguousSamples,
  codeDiffers: target.codeDiffersSamples,
});

const timingsOf = (result: CargarLocalidadesResult): TimingView[] =>
  result.stepTimings.map((timing) => ({ label: timing.label, seconds: timing.ms / MS_PER_SECOND }));

export function buildCargarLocalidadesReportView(result: CargarLocalidadesResult): CargarLocalidadesReportView {
  const timings = timingsOf(result);
  return {
    banners: reportBannersOf(result),
    kpis: kpisOf(result),
    skippedRows: skipRowsOf(result),
    zeroReasonCount: zeroReasonCountOf(result),
    skippedSamples: result.skipped.samples,
    warnings: result.warnings.filter((warning) => warning !== DRY_RUN_WARNING && warning !== COMMIT_UNKNOWN_WARNING),
    targets: result.targets.map(targetViewOf),
    timings,
    totalSeconds: timings.reduce((total, timing) => total + timing.seconds, 0),
  };
}
