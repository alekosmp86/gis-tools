import { ejesAttrChangesOf } from "../jobs/ejes-calles/domain/attrChanges";
import type { EjesAttrRow, EjesResult, EjesUnknownValue } from "../jobs/ejes-calles/types";
import { plural } from "../jobs/shared/text";
import type { ReportBannerView, ReportKpiView, TimingItemView } from "./ReportParts";
import { listSummaryOf, timingsViewOf } from "./reportViewParts";

export const EJES_DRY_RUN_BANNER = "Análisis: no se modificó ninguna tabla.";

const PERCENT_SCALE = 100;

export interface EjesListSummaries {
  splits: string;
  merges: string;
  plainRemovals: string;
  newStreets: string;
  attrChanges: string;
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
  timings: TimingItemView[];
  totalSeconds: number;
}

const unknownTextOf = (entry: EjesUnknownValue): string => `${entry.value ?? "sin dato"}: ${plural(entry.rows, "fila", "filas")}`;

export const coverageTextOf = (coverage: number | null): string =>
  coverage === null ? "sin dato" : `${Math.round(coverage * PERCENT_SCALE)}%`;

const kpi = (label: string, value: number): ReportKpiView => ({ label, value });

function kpiGroupsOf(result: EjesResult): EjesKpiGroup[] {
  const { staging, counts, cloc } = result;
  const problems = [
    kpi("reftramo que no es un número", staging.nonIntegerRefs),
    kpi("Filas sin geometría", staging.emptyGeometry),
    kpi("Filas sin idcalle", staging.emptyIdcalle),
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
        kpi("Nuevos", counts.newSections),
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
        kpi("Divididos en varios nuevos", counts.splits),
        kpi("Unidos en uno nuevo", counts.merges),
        kpi("Sin reemplazo", counts.plainRemovals),
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
  plainRemovals: listSummaryOf("Tramos quitados sin reemplazo", result.plainRemovals.length, result.counts.plainRemovals),
  newStreets: listSummaryOf("Calles nuevas", result.newStreets.length, result.counts.newStreets),
  attrChanges: listSummaryOf("Tramos con cambios de nombre, calle, tipo o fuente", result.attrChanges.length, result.counts.attr),
});

export function buildEjesReportView(result: EjesResult): EjesReportView {
  const { timings, totalSeconds } = timingsViewOf(result.stepTimings);
  return {
    banners: [{ kind: "dryRun", text: EJES_DRY_RUN_BANNER }],
    kpiGroups: kpiGroupsOf(result),
    blockers: result.blockers,
    privilegeInfo: result.privilegeInfo,
    unknownTipos: result.staging.unknownTipos.map(unknownTextOf),
    unknownFuentes: result.staging.unknownFuentes.map(unknownTextOf),
    summaries: summariesOf(result),
    attrRows: result.attrChanges.map((row) => ({ ...row, changes: ejesAttrChangesOf(row).join(", ") })),
    timings,
    totalSeconds,
  };
}
