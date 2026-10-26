import type {
  AmbiguousLocalityCode,
  AttributeConflictSample,
  CargarPadronesResult,
  TypeReport,
} from "../jobs/cargar-padrones/types";

export interface ReportRow {
  label: string;
  value: number;
}

export interface ConflictSampleView {
  unit: "rural" | "urbano";
  key: string;
  column: string;
  values: string[];
}

export interface AmbiguousCodeView {
  coddepto: string | number | null;
  codloccat: string | number | null;
  names: string[];
}

export interface TimingView {
  label: string;
  seconds: number;
}

export interface AnalyzeView {
  status: CargarPadronesResult["analyze"]["status"];
  label: string;
  message?: string;
}

export type ReportBannerKind = "unknown" | "dryRun" | "warning" | "done";

export interface ReportBanner {
  kind: ReportBannerKind;
  text: string;
}

export interface CargarPadronesReportView {
  rural: ReportRow[];
  urbano: ReportRow[];
  totals: ReportRow[];
  warnings: string[];
  conflictSamples: ConflictSampleView[];
  moreConflicts: number;
  ambiguousLocalityCodes: AmbiguousCodeView[];
  timings: TimingView[];
  totalSeconds: number;
  analyze: AnalyzeView;
  banner: ReportBanner;
}

const MAX_CONFLICT_SAMPLES = 20;
const MAX_AMBIGUOUS_CODES = 20;
const MS_PER_SECOND = 1000;
const HUNDREDTHS_PER_UNIT = 100;

const ANALYZE_LABELS: Record<CargarPadronesResult["analyze"]["status"], string> = {
  ok: "Estadísticas actualizadas",
  failed: "No se pudieron actualizar las estadísticas",
  skipped: "No se actualizaron las estadísticas",
};

const BANNER_TEXT = {
  unknown: "Resultado incierto: verificar la tabla destino antes de volver a cargar.",
  dryRun: "Simulación: no se modificó la tabla destino.",
  warning: "La carga terminó con advertencias. Revise el informe.",
  done: "Carga terminada: la tabla destino se actualizó.",
} as const;

const roundSeconds = (ms: number): number =>
  Math.round((ms / MS_PER_SECOND) * HUNDREDTHS_PER_UNIT) / HUNDREDTHS_PER_UNIT;

const usesNoRepairRows = (reports: TypeReport[]): boolean =>
  reports.some((report) => report.insertedInvalid > 0 || report.repairedInUnion > 0);

function typeRows(report: TypeReport, noRepair: boolean): ReportRow[] {
  const repairRows = noRepair
    ? [
        { label: "Insertadas inválidas", value: report.insertedInvalid },
        { label: "Reparadas en la unión", value: report.repairedInUnion },
      ]
    : [{ label: "Reparadas", value: report.repaired }];
  return [
    { label: "Filas leídas", value: report.rowsRead },
    ...repairRows,
    { label: "Sin geometría", value: report.noGeometry },
    { label: "Claves vacías", value: report.nullKeyRows },
    { label: "Grupos", value: report.groups },
    { label: "Filas fusionadas", value: report.rowsMerged },
    { label: "Conflictos de atributos", value: report.attributeConflicts },
    { label: "Insertadas", value: report.inserted },
  ];
}

function conflictSamplesOf(
  unit: ConflictSampleView["unit"],
  samples: AttributeConflictSample[],
): ConflictSampleView[] {
  return samples.map((sample) => ({ unit, key: sample.key, column: sample.column, values: [...sample.values] }));
}

function bannerOf(result: CargarPadronesResult): ReportBanner {
  if (result.outcomeUnknown) return { kind: "unknown", text: BANNER_TEXT.unknown };
  if (result.dryRun) return { kind: "dryRun", text: BANNER_TEXT.dryRun };
  if (result.warnings.length > 0) return { kind: "warning", text: BANNER_TEXT.warning };
  return { kind: "done", text: BANNER_TEXT.done };
}

function analyzeOf(result: CargarPadronesResult): AnalyzeView {
  const { status, message } = result.analyze;
  return message === undefined
    ? { status, label: ANALYZE_LABELS[status] }
    : { status, label: ANALYZE_LABELS[status], message };
}

export function buildReportView(result: CargarPadronesResult): CargarPadronesReportView {
  const { rural, urbano } = result.report;
  const noRepair = usesNoRepairRows([rural, urbano]);
  const samples = [
    ...conflictSamplesOf("rural", rural.attributeConflictSamples),
    ...conflictSamplesOf("urbano", urbano.attributeConflictSamples),
  ];
  const shownSamples = samples.slice(0, MAX_CONFLICT_SAMPLES);
  const totalConflicts = rural.attributeConflicts + urbano.attributeConflicts;

  return {
    rural: typeRows(rural, noRepair),
    urbano: typeRows(urbano, noRepair),
    totals: [
      { label: "Filas leídas", value: result.totals.rowsRead },
      { label: "Grupos", value: result.totals.groups },
      { label: "Filas fusionadas", value: result.totals.rowsMerged },
      { label: "Insertadas", value: result.totals.inserted },
    ],
    warnings: [...result.warnings],
    conflictSamples: shownSamples,
    moreConflicts: Math.max(0, totalConflicts - shownSamples.length),
    ambiguousLocalityCodes: result.ambiguousLocalityCodes
      .slice(0, MAX_AMBIGUOUS_CODES)
      .map((code: AmbiguousLocalityCode) => ({
        coddepto: code.coddepto,
        codloccat: code.codloccat,
        names: [...code.nomloccat],
      })),
    timings: result.stepTimings.map((timing) => ({ label: timing.label, seconds: roundSeconds(timing.ms) })),
    totalSeconds: roundSeconds(result.stepTimings.reduce((sum, timing) => sum + timing.ms, 0)),
    analyze: analyzeOf(result),
    banner: bannerOf(result),
  };
}
