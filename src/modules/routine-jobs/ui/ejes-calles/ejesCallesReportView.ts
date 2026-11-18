import { AMBIGUOUS_POINT_GAP_M, FAR_POINT_REPORT_M, TWIN_CLASS, type TwinClass } from "../../jobs/ejes-calles/constants";
import { ejesAttrChangesOf } from "../../jobs/ejes-calles/domain/attrChanges";
import type { EjesAttrRow, EjesResult, EjesSplitRow, EjesTwinRow, EjesUnknownValue } from "../../jobs/ejes-calles/types";
import { plural } from "../../jobs/shared/text";
import type { ReportBannerView, ReportKpiView, TimingItemView } from "../shared/ReportParts";
import { defaultOpenListOf, stripOf, type EjesListKey, type EjesStripItem } from "./ejesCallesListMeta";
import { listSummaryOf, timingsViewOf } from "../shared/reportViewParts";

export const EJES_DRY_RUN_BANNER = "Análisis: no se modificó ninguna tabla.";

const PERCENT_SCALE = 100;

export interface EjesListSummaries {
  splits: string;
  merges: string;
  plainRemovals: string;
  newStreets: string;
  attrChanges: string;
  twins: string;
  geoTwins: string;
  invalidGeometries: string;
  renumbered: string;
  renumberHeld: string;
}

export interface EjesAttrRowView extends EjesAttrRow {
  changes: string;
}

export interface EjesKpiGroup {
  title: string;
  kpis: ReportKpiView[];
  emptyText?: string;
}

export interface EjesReportView {
  banners: ReportBannerView[];
  kpiGroups: EjesKpiGroup[];
  blockers: string[];
  privilegeInfo: string[];
  unknownTipos: string[];
  unknownFuentes: string[];
  summaries: EjesListSummaries;
  attrRows: EjesAttrRowView[];
  strip: EjesStripItem[];
  defaultOpenList: EjesListKey | null;
  timings: TimingItemView[];
  totalSeconds: number;
}

const unknownTextOf = (entry: EjesUnknownValue): string => `${entry.value ?? "sin dato"}: ${plural(entry.rows, "fila", "filas")}`;

export const coverageTextOf = (coverage: number | null): string =>
  coverage === null ? "sin dato" : `${Math.round(coverage * PERCENT_SCALE)}%`;

const METER_DECIMALS = 1;

export const metersTextOf = (meters: number | null): string => (meters === null ? "sin dato" : meters.toFixed(METER_DECIMALS));

const TWIN_CASE_TEXT: Record<TwinClass, string> = {
  [TWIN_CLASS.URBAN]: "Cerca de padrones urbanos",
  [TWIN_CLASS.RURAL]: "Cerca de padrones rurales",
  [TWIN_CLASS.BOTH]: "Cerca de ambos: se mantiene una",
  [TWIN_CLASS.NEITHER]: "Lejos de padrones: sin regla",
};

export const twinCaseTextOf = (twinClass: TwinClass): string => TWIN_CASE_TEXT[twinClass];

export type TwinTextRow = Pick<EjesTwinRow, "class" | "dropLocalities"> & Partial<Pick<EjesTwinRow, "localities" | "insideLocalities">>;

const CROSSES_LOCALITIES = "Cruza varias localidades";

const NO_DATA_TEXT = "sin dato";

const normalizedName = (locality: string): string => locality.trim().toUpperCase();

const insideCountOf = (row: TwinTextRow): number => {
  const inside = new Set(row.insideLocalities ?? []);
  return (row.localities ?? []).filter((locality) => inside.has(normalizedName(locality))).length;
};

const keptWinnerOf = (row: TwinTextRow): string | undefined => {
  const dropped = new Set(row.dropLocalities.map(normalizedName));
  const kept = new Set((row.localities ?? []).map(normalizedName).filter((locality) => !dropped.has(locality)));
  return (row.insideLocalities ?? []).find((locality) => kept.has(locality));
};

const isCrossingDrop = (row: TwinTextRow): boolean =>
  row.class === TWIN_CLASS.NEITHER && row.dropLocalities.length > 0 && insideCountOf(row) >= 2;

const isPolygonDrop = (row: TwinTextRow): boolean =>
  row.class === TWIN_CLASS.NEITHER && row.dropLocalities.length > 0 && (row.insideLocalities ?? []).length > 0;

export const twinRowCaseTextOf = (row: TwinTextRow): string => {
  if (isCrossingDrop(row)) return CROSSES_LOCALITIES;
  if (isPolygonDrop(row)) return "Lejos de padrones: por polígono de localidad";
  if (row.class === TWIN_CLASS.NEITHER && row.dropLocalities.length > 0) return "Lejos de padrones: regla rural";
  return TWIN_CASE_TEXT[row.class];
};

export const twinDecisionTextOf = (row: TwinTextRow): string => {
  if (isCrossingDrop(row)) {
    return `${CROSSES_LOCALITIES}: se queda ${keptWinnerOf(row) ?? NO_DATA_TEXT} (mayor largo dentro); se quitaría: ${row.dropLocalities.join(", ")}`;
  }
  if (isPolygonDrop(row)) {
    const verb = row.dropLocalities.length === 1 ? "se quita" : "se quitan";
    return `Dentro de ${(row.insideLocalities ?? []).join(", ")}: ${verb} ${row.dropLocalities.join(", ")}`;
  }
  if (row.dropLocalities.length > 0) return `Se quitaría: ${row.dropLocalities.join(", ")}`;
  return row.class === TWIN_CLASS.NEITHER ? "Sin regla: se mantienen todas" : "Se mantienen todas";
};

const kpi = (label: string, value: number): ReportKpiView => ({ label, value });

function kpiGroupsOf(result: EjesResult): EjesKpiGroup[] {
  const { staging, counts, cloc } = result;
  const problems = [
    kpi("reftramo que no es un número", staging.nonIntegerRefs),
    kpi("Filas sin geometría", staging.emptyGeometry),
    kpi("Filas sin idcalle", staging.emptyIdcalle),
    kpi("Filas con geometría inválida o colapsada (se omiten)", staging.invalidGeometryRows),
    kpi("Tramos con geometría inválida o colapsada", staging.invalidGeometryRefs),
    kpi("Filas con caracteres dañados (�)", staging.damagedTextRows),
    kpi("Filas con tipo de vía desconocido", staging.unknownTipoRows),
    kpi("Filas con fuente desconocida", staging.unknownFuenteRows),
  ].filter((entry) => entry.value > 0);
  return [
    {
      title: "Archivo cargado en el origen",
      kpis: [
        kpi("Filas", staging.rows),
        kpi("Tramos distintos", staging.distinctRefs),
        kpi("Tramos con más de una fila", staging.repeatedGroups),
        kpi("Filas de esos tramos", staging.repeatedRows),
      ],
    },
    { title: "Problemas en el archivo", kpis: problems, emptyText: "Sin problemas." },
    {
      title: "Tramos del archivo frente a los actuales",
      kpis: [
        kpi("Nuevos", counts.newSections - counts.renumbered),
        kpi("Sin cambios", counts.unchanged),
        kpi("Cambió nombre, calle, tipo o fuente", counts.attr),
        kpi("Cambió el trazado", counts.geom),
        kpi("Cambió todo", counts.both),
      ],
    },
    {
      title: "Tramos actuales que ya no vienen en el archivo",
      kpis: [
        kpi("Total", counts.removed),
        kpi("Renumerados (mismo trazado, otro reftramo)", counts.renumbered),
        kpi("Renumerados con puntos de acceso", counts.renumberedWithPoints),
        kpi("Puntos de acceso que seguirían al renumerar", counts.renumberedPoints),
        kpi("Divididos en varios nuevos", counts.splits),
        kpi("Unidos en uno nuevo", counts.merges),
        kpi("Sin reemplazo, se quitarían", counts.plainRemovals - counts.plainHeld),
        kpi("Sin reemplazo, con puntos de acceso: no se quitan", counts.plainHeld),
      ],
    },
    {
      title: "Puntos de acceso de los tramos divididos (por reftramo)",
      kpis: [
        kpi("Total", counts.splitPointsTotal),
        kpi("Destino automático", counts.splitPointsAuto),
        kpi(`A revisar: los dos tramos más cercanos a menos de ${AMBIGUOUS_POINT_GAP_M} m`, counts.splitPointsReview),
        kpi("Sin geometría", counts.splitPointsNoGeometry),
        kpi(`Lejos de todo tramo nuevo (más de ${FAR_POINT_REPORT_M} m, solo informativo)`, counts.splitPointsFar),
      ],
    },
    {
      title: "Tramos repetidos por localidad",
      kpis: [
        kpi("Total", counts.twins),
        kpi("Cerca de urbanos solamente", counts.twinsUrban),
        kpi("Cerca de rurales solamente", counts.twinsRural),
        kpi("Cerca de ambos", counts.twinsBoth),
        kpi("Lejos de ambos", counts.twinsNeither),
        kpi("Se quitaría alguna copia", counts.twinsDrop),
        kpi("Se mantienen todas", counts.twinsKeep),
        kpi("En más de un departamento: sin regla", counts.twinsCrossDepartment),
      ],
    },
    {
      title: "Gemelos por geometría (complemento de las localidades: después de ellas)",
      kpis: [
        kpi("Grupos", counts.geoTwinGroups),
        kpi("Tramos en grupos", counts.geoTwinSections),
        kpi("Se quitarían al aceptar (en carto)", counts.geoTwinLosersRemovable),
        kpi("No se cargan (no están en carto)", counts.geoTwinLosersOmitted),
        kpi("Con varias copias tras la regla de localidades: no agrupados", counts.geoTwinSkippedRefs),
      ],
    },
    {
      title: "Calles y localidades de los tramos nuevos o con trazado distinto",
      kpis: [
        kpi("Calles nuevas", counts.newStreets),
        kpi("Con localidad", cloc.withLocality),
        kpi("Solo con departamento", cloc.onlyDepartment),
        kpi("Sin código", cloc.withoutCode),
      ],
    },
  ];
}

const summariesOf = (result: EjesResult): EjesListSummaries => ({
  splits: listSummaryOf("Tramos divididos", result.splits.length, result.counts.splits),
  merges: listSummaryOf("Tramos unidos", result.merges.length, result.counts.merges),
  plainRemovals: listSummaryOf("Tramos sin reemplazo (primero los que tienen puntos de acceso)", result.plainRemovals.length, result.counts.plainRemovals),
  newStreets: listSummaryOf("Calles nuevas", result.newStreets.length, result.counts.newStreets),
  attrChanges: listSummaryOf("Tramos con cambios de nombre, calle, tipo o fuente", result.attrChanges.length, result.counts.attr),
  invalidGeometries: listSummaryOf("Tramos con geometría inválida o colapsada (se omiten)", result.staging.invalidGeometries.length, result.staging.invalidGeometryRows),
  renumbered: listSummaryOf("Tramos renumerados (primero los que tienen puntos de acceso)", result.renumbered.length, result.counts.renumbered),
  renumberHeld: listSummaryOf("Renumerados retenidos (ambos tramos quedan como están)", result.renumberSkipped.length, result.counts.renumberSkipped),
  twins: listSummaryOf("Tramos repetidos por localidad (primero los que se deciden en el mapa)", result.twins.length, result.counts.twins),
  geoTwins: listSummaryOf("Tramos gemelos por geometría (complemento de las localidades)", result.geoTwins.length, result.counts.geoTwinSections),
});

export function buildEjesReportView(result: EjesResult): EjesReportView {
  const { timings, totalSeconds } = timingsViewOf(result.stepTimings);
  return {
    banners: result.dryRun ? [{ kind: "dryRun", text: EJES_DRY_RUN_BANNER }] : [],
    kpiGroups: kpiGroupsOf(result),
    blockers: result.blockers,
    privilegeInfo: result.privilegeInfo,
    unknownTipos: result.staging.unknownTipos.map(unknownTextOf),
    unknownFuentes: result.staging.unknownFuentes.map(unknownTextOf),
    summaries: summariesOf(result),
    attrRows: result.attrChanges.map((row) => ({ ...row, changes: ejesAttrChangesOf(row).join(", ") })),
    strip: stripOf(result),
    defaultOpenList: defaultOpenListOf(result),
    timings,
    totalSeconds,
  };
}

export const ATTENTION_RANK = { DECISION: 0, READY: 1, HELD: 2 } as const;

export type AttentionRank = (typeof ATTENTION_RANK)[keyof typeof ATTENTION_RANK];

export const ATTENTION_FILTER = { ALL: "all", DECISION: "decision", READY: "ready", HELD: "held" } as const;

export type AttentionFilter = (typeof ATTENTION_FILTER)[keyof typeof ATTENTION_FILTER];

type RankedFilter = Exclude<AttentionFilter, typeof ATTENTION_FILTER.ALL>;

const RANK_OF_FILTER: Record<RankedFilter, AttentionRank> = {
  [ATTENTION_FILTER.DECISION]: ATTENTION_RANK.DECISION,
  [ATTENTION_FILTER.READY]: ATTENTION_RANK.READY,
  [ATTENTION_FILTER.HELD]: ATTENTION_RANK.HELD,
};

export const FILTER_OF_RANK: Record<AttentionRank, RankedFilter> = {
  [ATTENTION_RANK.DECISION]: ATTENTION_FILTER.DECISION,
  [ATTENTION_RANK.READY]: ATTENTION_FILTER.READY,
  [ATTENTION_RANK.HELD]: ATTENTION_FILTER.HELD,
};

/** From the analysis alone: held or not acceptable (2), ready with no point pending (1), needs a point decision (0). */
const attentionRankOf = (row: EjesSplitRow): AttentionRank => {
  if (row.heldReason !== null || row.incompleteReview || row.oldRef === "" || row.points !== row.refPoints) return ATTENTION_RANK.HELD;
  return row.reviewPoints + row.noGeometryPoints > 0 ? ATTENTION_RANK.DECISION : ATTENTION_RANK.READY;
};

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const compareSplitsByAttention = (a: EjesSplitRow, b: EjesSplitRow): number =>
  attentionRankOf(a) - attentionRankOf(b) || b.points - a.points || compareText(a.oldRef, b.oldRef);

/** The splits by attention rank, then by points (most first), then by reftramo. A new array: the analysis order is untouched. */
export const sortSplitsByAttention = (rows: readonly EjesSplitRow[]): EjesSplitRow[] => [...rows].sort(compareSplitsByAttention);

export const attentionCountsOf = (rows: readonly EjesSplitRow[]): Record<AttentionRank, number> => {
  const counts: Record<AttentionRank, number> = { [ATTENTION_RANK.DECISION]: 0, [ATTENTION_RANK.READY]: 0, [ATTENTION_RANK.HELD]: 0 };
  for (const row of rows) counts[attentionRankOf(row)] += 1;
  return counts;
};

export const splitMatchesAttention = (row: EjesSplitRow, filter: AttentionFilter): boolean =>
  filter === ATTENTION_FILTER.ALL || attentionRankOf(row) === RANK_OF_FILTER[filter];
