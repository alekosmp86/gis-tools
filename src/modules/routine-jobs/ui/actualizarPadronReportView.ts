import { SKIP_REASON, type SkipReason } from "../jobs/actualizar-padron/constants";
import type { ActualizarPadronResult, CollidingKey, SkippedGroup, SkippedSample } from "../jobs/actualizar-padron/types";

export interface ReportRow {
  label: string;
  value: number;
}

export interface SkipReasonRow {
  reason: SkipReason;
  label: string;
  value: number;
}

export interface GroupRow {
  name: string;
  count: number;
}

export interface SampleView {
  department: string;
  locality: string;
  padron: string;
  reason: string;
}

export interface CollidingKeyView {
  keyLabel: string;
  rows: number;
}

export interface TimingView {
  label: string;
  seconds: number;
}

export interface AnalyzeView {
  status: ActualizarPadronResult["analyze"]["status"];
  label: string;
  message?: string;
}

export type ActualizarBannerKind = "unknown" | "dryRun" | "warning" | "done";

export interface ActualizarBanner {
  kind: ActualizarBannerKind;
  text: string;
}

export interface ActualizarReportView {
  banners: ActualizarBanner[];
  totals: ReportRow[];
  skippedByReason: SkipReasonRow[];
  byDepartment: GroupRow[];
  byLocality: GroupRow[];
  samples: SampleView[];
  collidingKeys: CollidingKeyView[];
  collidingKeyCount: number;
  warnings: string[];
  timings: TimingView[];
  totalSeconds: number;
  analyze: AnalyzeView;
}

const LIMIT = 20;
const EMPTY_VALUE = "sin dato";
const MS_PER_SECOND = 1000;
const HUNDREDTHS_PER_UNIT = 100;

const REASON_LABEL: Record<SkipReason, string> = {
  [SKIP_REASON.PROVINCIA_NO_ENCONTRADA]: "Provincia no encontrada",
  [SKIP_REASON.PROVINCIA_AMBIGUA]: "Provincia ambigua",
  [SKIP_REASON.LOCALIDAD_NO_ENCONTRADA]: "Localidad no encontrada",
  [SKIP_REASON.LOCALIDAD_AMBIGUA]: "Localidad ambigua",
  [SKIP_REASON.CLAVE_NULA]: "Clave nula",
  [SKIP_REASON.SIN_GEOMETRIA]: "Sin geometría",
  [SKIP_REASON.CLAVE_DUPLICADA]: "Clave duplicada",
};

const ANALYZE_LABELS: Record<ActualizarPadronResult["analyze"]["status"], string> = {
  ok: "Estadísticas actualizadas",
  failed: "No se pudieron actualizar las estadísticas",
  skipped: "No se actualizaron las estadísticas",
};

const BANNER_TEXT = {
  unknown: "Resultado incierto: hay que verificar la tabla de trabajo antes de volver a actualizar.",
  dryRun: "Análisis sin cargar: la tabla de trabajo no se modificó.",
  warning: "La actualización terminó con advertencias. Revise el informe.",
  done: "Actualización terminada: la tabla de trabajo se ha cargado.",
} as const;

const SKIP_REASONS = Object.values(SKIP_REASON) as SkipReason[];

const textOf = (value: string | null): string => (value === null || value.trim() === "" ? EMPTY_VALUE : value);

const numberTextOf = (value: number | null): string => (value === null ? EMPTY_VALUE : String(value));

const roundSeconds = (ms: number): number =>
  Math.round((ms / MS_PER_SECOND) * HUNDREDTHS_PER_UNIT) / HUNDREDTHS_PER_UNIT;

const reasonLabelOf = (reason: string): string =>
  (SKIP_REASONS as string[]).includes(reason) ? REASON_LABEL[reason as SkipReason] : reason;

function totalsOf(result: ActualizarPadronResult): ReportRow[] {
  const { totals } = result;
  return [
    { label: "Filas leídas de staging", value: totals.rowsRead },
    { label: "Filas aceptadas", value: totals.accepted },
    { label: "Filas escritas", value: totals.written },
    { label: "Geometrías reparadas", value: totals.repaired },
    { label: "Filas omitidas", value: totals.skipped },
  ];
}

function skippedByReasonOf(result: ActualizarPadronResult): SkipReasonRow[] {
  return SKIP_REASONS.map((reason) => ({
    reason,
    label: REASON_LABEL[reason],
    value: result.skipped.byReason[reason] ?? 0,
  }));
}

const groupsOf = (groups: SkippedGroup[]): GroupRow[] =>
  groups.slice(0, LIMIT).map((group) => ({ name: textOf(group.name), count: group.count }));

const samplesOf = (samples: SkippedSample[]): SampleView[] =>
  samples.slice(0, LIMIT).map((sample) => ({
    department: textOf(sample.department),
    locality: textOf(sample.locality),
    padron: textOf(sample.padron),
    reason: reasonLabelOf(sample.reason),
  }));

const collidingKeyLabelOf = (key: CollidingKey): string =>
  [
    `Tipo ${textOf(key.typePadron)}`,
    `provincia ${numberTextOf(key.idProvince)}`,
    `localidad ${numberTextOf(key.idCadastralLocality)}`,
    `número ${textOf(key.number)}`,
  ].join(", ");

const collidingKeysOf = (keys: CollidingKey[]): CollidingKeyView[] =>
  keys.slice(0, LIMIT).map((key) => ({ keyLabel: collidingKeyLabelOf(key), rows: key.rows }));

const timingsOf = (result: ActualizarPadronResult): TimingView[] =>
  result.stepTimings.map((timing) => ({ label: timing.label, seconds: roundSeconds(timing.ms) }));

function outcomeBannerOf(result: ActualizarPadronResult): ActualizarBanner {
  if (result.outcomeUnknown) return { kind: "unknown", text: BANNER_TEXT.unknown };
  if (result.dryRun) return { kind: "dryRun", text: BANNER_TEXT.dryRun };
  return { kind: "done", text: BANNER_TEXT.done };
}

function bannersOf(result: ActualizarPadronResult): ActualizarBanner[] {
  const outcome = outcomeBannerOf(result);
  if (result.warnings.length === 0) return [outcome];
  return [outcome, { kind: "warning", text: BANNER_TEXT.warning }];
}

function analyzeOf(result: ActualizarPadronResult): AnalyzeView {
  const { status, message } = result.analyze;
  return message === undefined
    ? { status, label: ANALYZE_LABELS[status] }
    : { status, label: ANALYZE_LABELS[status], message };
}

export function buildActualizarReportView(result: ActualizarPadronResult): ActualizarReportView {
  return {
    banners: bannersOf(result),
    totals: totalsOf(result),
    skippedByReason: skippedByReasonOf(result),
    byDepartment: groupsOf(result.skipped.byDepartment),
    byLocality: groupsOf(result.skipped.byLocality),
    samples: samplesOf(result.skipped.samples),
    collidingKeys: collidingKeysOf(result.skipped.collidingKeys),
    collidingKeyCount: result.skipped.collidingKeyCount,
    warnings: [...result.warnings],
    timings: timingsOf(result),
    totalSeconds: roundSeconds(result.stepTimings.reduce((sum, timing) => sum + timing.ms, 0)),
    analyze: analyzeOf(result),
  };
}
