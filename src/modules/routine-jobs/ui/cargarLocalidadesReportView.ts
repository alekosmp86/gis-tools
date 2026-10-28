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
import type { ReportBannerView } from "./ReportParts";
import { outcomeBannersOf, timingsViewOf, type OutcomeTexts } from "./reportViewParts";
import { reportRowToneOf, type ReportRowTone } from "./reportRowTone";

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
  tone: ReportRowTone;
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
  banners: ReportBannerView[];
  kpis: ReportKpi[];
  skippedRows: SkipReasonRow[];
  zeroReasonCount: number;
  skippedSamples: LocalitySkippedSample[];
  warnings: string[];
  targets: TargetView[];
  timings: TimingView[];
  totalSeconds: number;
}

const PERCENT_SCALE = 100;
const OUTCOME_TEXTS: OutcomeTexts = {
  unknown: "No se pudo confirmar el COMMIT. Verifique las dos tablas de localidades antes de volver a cargar.",
  dryRun: DRY_RUN_WARNING,
  done: "Carga confirmada: las tablas de localidades fueron modificadas.",
};

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

const countRowOf = (label: string, value: number, isNeutral = false): CountRow => ({
  label,
  value,
  tone: reportRowToneOf(value, isNeutral),
});

const targetViewOf = (target: TargetReport): TargetView => ({
  table: target.table,
  counts: [
    countRowOf("Insertadas", target.inserted),
    countRowOf("Actualizadas", target.updated),
    countRowOf("Geometrías que cambian", target.changed),
    countRowOf("Sin cambios", target.unchanged, true),
    countRowOf("Sin cambios dentro de tolerancia", target.unchangedWithinTolerance, true),
    countRowOf("Faltantes en origen", target.missing),
    countRowOf("Ambiguas", target.ambiguous),
    countRowOf("Código distinto", target.codeDiffers),
  ],
  notes: targetNotesOf(target),
  inserted: target.insertedList,
  geometryChanges: target.geometryChanges,
  missing: target.missingSamples,
  ambiguous: target.ambiguousSamples,
  codeDiffers: target.codeDiffersSamples,
});

export function buildCargarLocalidadesReportView(result: CargarLocalidadesResult): CargarLocalidadesReportView {
  const { timings, totalSeconds } = timingsViewOf(result.stepTimings);
  return {
    banners: outcomeBannersOf({ ...result, modified: result.targetsModified }, OUTCOME_TEXTS),
    kpis: kpisOf(result),
    skippedRows: skipRowsOf(result),
    zeroReasonCount: zeroReasonCountOf(result),
    skippedSamples: result.skipped.samples,
    warnings: result.warnings.filter((warning) => warning !== DRY_RUN_WARNING && warning !== COMMIT_UNKNOWN_WARNING),
    targets: result.targets.map(targetViewOf),
    timings,
    totalSeconds,
  };
}
