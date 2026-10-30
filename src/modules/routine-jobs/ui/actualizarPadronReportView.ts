import { PAIR_STATUS, SKIP_REASON, type PairStatus, type SkipReason } from "../jobs/actualizar-padron/constants";
import { COMMIT_UNKNOWN_WARNING, DRY_RUN_WARNING } from "../jobs/actualizar-padron/domain/warnings";
import type {
  ActualizarPadronResult,
  ActualizarTargetReport,
  CollidingKey,
  PadronGeometryChange,
  PadronInserted,
  PadronKey,
  PadronPair,
  SkippedGroup,
  SkippedLocalityGroup,
  SkippedSample,
} from "../jobs/actualizar-padron/types";
import { PAIR_LIST_LIMIT } from "../jobs/shared/limits";
import { buildPadronRefreshStatement } from "../jobs/actualizar-padron/domain/refreshSuggestion";
import { addressMasterViewOf, type AddressMasterView } from "./addressMasterReportView";
import { PADRON_ADDRESS_MASTER_TEXTS } from "./addressMasterSubjectTexts";
import { reportRowToneOf, type ReportRowTone } from "./reportRowTone";
import type { RefreshSuggestionView } from "./refreshSuggestionView";
import { listSummaryOf } from "./reportViewParts";

export interface KpiView {
  label: string;
  value: number;
}

export interface SkipReasonRow {
  reason: SkipReason;
  label: string;
  value: number;
}

export interface SkippedReasonRow extends SkipReasonRow {
  percent: number;
  barStep: number;
  hint: string;
}

export interface GroupRow {
  name: string;
  count: number;
}

export interface GroupSplit {
  top: GroupRow[];
  rest: GroupRow[];
  restCount: number;
}

export interface LocalityRow {
  department: string;
  locality: string;
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

export interface TargetCountRow {
  label: string;
  value: number;
  tone: ReportRowTone;
}

export interface PairView {
  key: string;
  department: string;
  oldLocality: string;
  newLocality: string;
  oldType: string;
  newType: string;
  oldNumber: string;
  newNumber: string;
  distance: number | null;
  status: string;
}

export interface TargetView {
  table: string;
  counts: TargetCountRow[];
  notes: string[];
  inserted: PadronInserted[];
  insertedSummary: string;
  geometryChanges: PadronGeometryChange[];
  geometryChangesSummary: string;
  missing: PadronKey[];
  missingSummary: string;
  ambiguous: PadronKey[];
  ambiguousSummary: string;
  pairs: PairView[];
  pairsSummary: string;
}

export type ActualizarBannerKind = "unknown" | "dryRun" | "warning" | "done";

export interface ActualizarBanner {
  kind: ActualizarBannerKind;
  text: string;
}

export interface ActualizarReportView {
  banners: ActualizarBanner[];
  kpis: KpiView[];
  skippedRows: SkippedReasonRow[];
  zeroReasonCount: number;
  byDepartmentSplit: GroupSplit;
  byLocalitySplit: GroupSplit;
  localitiesNotFound: LocalityRow[];
  localitiesAmbiguous: LocalityRow[];
  samples: SampleView[];
  collidingKeys: CollidingKeyView[];
  collidingKeyCount: number;
  target: TargetView;
  addressMaster: AddressMasterView | null;
  suggestion: RefreshSuggestionView | null;
  warnings: string[];
  timings: TimingView[];
  totalSeconds: number;
}

const LIMIT = 20;
const TOP_LIMIT = 10;
const EMPTY_VALUE = "sin dato";
const MS_PER_SECOND = 1000;
const HUNDREDTHS_PER_UNIT = 100;
const PERCENT_SCALE = 100;
const BAR_STEP_PERCENT = 5;

const REASON_LABEL: Record<SkipReason, string> = {
  [SKIP_REASON.PROVINCIA_NO_ENCONTRADA]: "Provincia no encontrada",
  [SKIP_REASON.PROVINCIA_AMBIGUA]: "Provincia ambigua",
  [SKIP_REASON.LOCALIDAD_NO_ENCONTRADA]: "Localidad no encontrada",
  [SKIP_REASON.LOCALIDAD_AMBIGUA]: "Localidad ambigua",
  [SKIP_REASON.CLAVE_NULA]: "Clave nula",
  [SKIP_REASON.SIN_GEOMETRIA]: "Sin geometría",
  [SKIP_REASON.CLAVE_DUPLICADA]: "Clave duplicada",
};

const REASON_HINT: Record<SkipReason, string> = {
  [SKIP_REASON.PROVINCIA_NO_ENCONTRADA]: "La coincidencia de provincia es por nombre: el departamento del padrón no coincide con ningún nombre de la tabla de provincias.",
  [SKIP_REASON.PROVINCIA_AMBIGUA]: "El nombre de la provincia coincide con más de una. Revise la tabla de provincias.",
  [SKIP_REASON.LOCALIDAD_NO_ENCONTRADA]: "La localidad no existe en su provincia. Vea la lista de localidades no encontradas.",
  [SKIP_REASON.LOCALIDAD_AMBIGUA]: "La localidad coincide con más de una en su provincia. Revise la tabla de localidades.",
  [SKIP_REASON.CLAVE_NULA]: "Falta el tipo de unidad (unidadcat), el departamento, la localidad (en urbano) o el número. Corrija la tabla de origen.",
  [SKIP_REASON.SIN_GEOMETRIA]: "La fila no tiene una geometría utilizable. Corrija la geometría en la tabla de origen.",
  [SKIP_REASON.CLAVE_DUPLICADA]: "Varias filas comparten la misma clave y todas se omiten. Revise la tabla de origen.",
};

const REFRESH_SUGGESTION_TEXT =
  "Las vistas materializadas de padrones no se actualizan solas. Refrésquelas, en este orden, para que el mapa y el WMS muestren los cambios:";

const BANNER_TEXT = {
  unknown: "Resultado incierto: hay que verificar la tabla de destino antes de volver a actualizar.",
  dryRun: "Análisis: la tabla de destino no fue modificada.",
  warning: "La actualización terminó con advertencias. Revise el informe.",
  done: "Actualización confirmada: la tabla de destino fue modificada.",
} as const;

const SKIP_REASONS = Object.values(SKIP_REASON) as SkipReason[];

const PAIR_STATUS_LABEL: Record<PairStatus, string> = {
  [PAIR_STATUS.APPLIED]: "Aplicado",
  [PAIR_STATUS.NOT_APPLIED_AMBIGUOUS]: "No aplicado: ambiguo",
};

const textOf = (value: string | null): string => (value === null || value.trim() === "" ? EMPTY_VALUE : value);

const numberTextOf = (value: number | null): string => (value === null ? EMPTY_VALUE : String(value));

const roundSeconds = (ms: number): number =>
  Math.round((ms / MS_PER_SECOND) * HUNDREDTHS_PER_UNIT) / HUNDREDTHS_PER_UNIT;

export const reasonLabelOf = (reason: string): string =>
  (SKIP_REASONS as string[]).includes(reason) ? REASON_LABEL[reason as SkipReason] : reason;

const shareOf = (value: number, total: number): number => (total === 0 ? 0 : (value * PERCENT_SCALE) / total);

const percentOf = (value: number, total: number): number => Math.round(shareOf(value, total));

const barStepOf = (value: number, total: number): number =>
  Math.round(shareOf(value, total) / BAR_STEP_PERCENT) * BAR_STEP_PERCENT;

function kpisOf(result: ActualizarPadronResult): KpiView[] {
  const { totals, target } = result;
  return [
    { label: "Filas leídas", value: totals.rowsRead },
    { label: "Candidatas", value: totals.candidates },
    { label: "Omitidas", value: totals.skipped },
    { label: "Insertadas", value: target.inserted },
    { label: "Actualizadas", value: target.updated },
    { label: "Geometrías que cambian", value: target.changed },
  ];
}

function skippedByReasonOf(result: ActualizarPadronResult): SkipReasonRow[] {
  return SKIP_REASONS.map((reason) => ({
    reason,
    label: REASON_LABEL[reason],
    value: result.skipped.byReason[reason] ?? 0,
  }));
}

function skippedRowsOf(rows: SkipReasonRow[]): SkippedReasonRow[] {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return rows
    .filter((row) => row.value > 0)
    .sort((first, second) => second.value - first.value)
    .map((row) => ({
      ...row,
      percent: percentOf(row.value, total),
      barStep: barStepOf(row.value, total),
      hint: REASON_HINT[row.reason],
    }));
}

const groupsOf = (groups: SkippedGroup[]): GroupRow[] =>
  groups.slice(0, LIMIT).map((group) => ({ name: textOf(group.name), count: group.count }));

const splitOf = (groups: GroupRow[]): GroupSplit => ({
  top: groups.slice(0, TOP_LIMIT),
  rest: groups.slice(TOP_LIMIT),
  restCount: Math.max(0, groups.length - TOP_LIMIT),
});

const localityRowsOf = (groups: SkippedLocalityGroup[], reason: SkipReason): LocalityRow[] =>
  groups
    .filter((group) => group.reason === reason)
    .sort((first, second) => second.count - first.count)
    .slice(0, LIMIT)
    .map((group) => ({ department: textOf(group.department), locality: textOf(group.locality), count: group.count }));

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

const changedRowsOf = (target: ActualizarTargetReport): number => target.inserted + target.updated + target.pairsApplied;

function suggestionOf(result: ActualizarPadronResult): RefreshSuggestionView | null {
  if (result.dryRun || !(result.targetModified || result.outcomeUnknown) || changedRowsOf(result.target) === 0) return null;
  return { text: REFRESH_SUGGESTION_TEXT, statement: buildPadronRefreshStatement(result.target.schema) };
}

function bannersOf(result: ActualizarPadronResult): ActualizarBanner[] {
  const outcome = outcomeBannerOf(result);
  if (visibleWarningsOf(result).length === 0) return [outcome];
  return [outcome, { kind: "warning", text: BANNER_TEXT.warning }];
}

const visibleWarningsOf = (result: ActualizarPadronResult): string[] =>
  result.warnings.filter((warning) => warning !== DRY_RUN_WARNING && warning !== COMMIT_UNKNOWN_WARNING);

const PAIRS_SECTION_TITLE = "Padrones reclasificados o renumerados";

const targetCountRowOf = (label: string, value: number, isNeutral = false): TargetCountRow => ({
  label,
  value,
  tone: reportRowToneOf(value, isNeutral),
});

const targetNotesOf = (target: ActualizarTargetReport): string[] => [
  ...(target.changed > 0 && !target.updateApplied
    ? [`Las geometrías que cambian no se aplicaron en ${target.table} (Actualizar geometrías desactivado).`]
    : []),
  ...(target.pairsTotal > PAIR_LIST_LIMIT
    ? [`Lista incompleta: se muestran los primeros ${PAIR_LIST_LIMIT} pares de ${target.pairsTotal} en ${target.table}.`]
    : []),
];

const pairKeyOf = (pair: PadronPair): string =>
  [pair.oldId, pair.new.typePadron, pair.new.provinceId, pair.new.localityId, pair.new.number].join("|");

const pairViewOf = (pair: PadronPair): PairView => ({
  key: pairKeyOf(pair),
  department: textOf(pair.new.department),
  oldLocality: textOf(pair.old.locality),
  newLocality: textOf(pair.new.locality),
  oldType: textOf(pair.old.typePadron),
  newType: textOf(pair.new.typePadron),
  oldNumber: textOf(pair.old.number),
  newNumber: textOf(pair.new.number),
  distance: pair.distance,
  status: PAIR_STATUS_LABEL[pair.status],
});

function targetViewOf(target: ActualizarTargetReport): TargetView {
  return {
    table: target.table,
    counts: [
      targetCountRowOf("Insertadas", target.inserted),
      targetCountRowOf("Actualizadas", target.updated),
      targetCountRowOf("Claves actualizadas", target.pairsApplied),
      targetCountRowOf("Geometrías que cambian", target.changed),
      targetCountRowOf("Sin cambios", target.unchanged, true),
      targetCountRowOf("Sin cambios dentro de tolerancia", target.unchangedWithinTolerance, true),
      targetCountRowOf("Faltantes en destino", target.missing),
      targetCountRowOf("Ambiguas", target.ambiguous),
    ],
    notes: targetNotesOf(target),
    inserted: target.insertedList,
    insertedSummary: listSummaryOf("Padrones insertados", target.insertedList.length, target.inserted),
    geometryChanges: target.geometryChanges,
    geometryChangesSummary: listSummaryOf("Geometrías que cambian", target.geometryChanges.length, target.changed),
    missing: target.missingSamples,
    missingSummary: listSummaryOf("Faltantes en destino", target.missingSamples.length, target.missing),
    ambiguous: target.ambiguousSamples,
    ambiguousSummary: listSummaryOf("Ambiguas", target.ambiguousSamples.length, target.ambiguous),
    pairs: target.pairs.map(pairViewOf),
    pairsSummary: listSummaryOf(PAIRS_SECTION_TITLE, target.pairs.length, target.pairsTotal),
  };
}

export function buildActualizarReportView(result: ActualizarPadronResult): ActualizarReportView {
  const skippedByReason = skippedByReasonOf(result);
  const byDepartment = groupsOf(result.skipped.byDepartment);
  const byLocality = groupsOf(result.skipped.byLocality);
  return {
    banners: bannersOf(result),
    kpis: kpisOf(result),
    skippedRows: skippedRowsOf(skippedByReason),
    zeroReasonCount: skippedByReason.filter((row) => row.value === 0).length,
    byDepartmentSplit: splitOf(byDepartment),
    byLocalitySplit: splitOf(byLocality),
    localitiesNotFound: localityRowsOf(result.skipped.byLocalityAndReason, SKIP_REASON.LOCALIDAD_NO_ENCONTRADA),
    localitiesAmbiguous: localityRowsOf(result.skipped.byLocalityAndReason, SKIP_REASON.LOCALIDAD_AMBIGUA),
    samples: samplesOf(result.skipped.samples),
    collidingKeys: collidingKeysOf(result.skipped.collidingKeys),
    collidingKeyCount: result.skipped.collidingKeyCount,
    target: targetViewOf(result.target),
    addressMaster: result.addressMaster === undefined ? null : addressMasterViewOf(result.addressMaster, PADRON_ADDRESS_MASTER_TEXTS),
    suggestion: suggestionOf(result),
    warnings: visibleWarningsOf(result),
    timings: timingsOf(result),
    totalSeconds: roundSeconds(result.stepTimings.reduce((sum, timing) => sum + timing.ms, 0)),
  };
}
