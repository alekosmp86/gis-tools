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

export interface EjesReportView {
  banners: ReportBannerView[];
  kpis: ReportKpiView[];
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

function kpisOf(result: EjesResult): ReportKpiView[] {
  const { staging, counts, cloc } = result;
  return [
    { label: "Filas de origen", value: staging.rows },
    { label: "reftramo distintos", value: staging.distinctRefs },
    { label: "reftramo repetidos (grupos)", value: staging.repeatedGroups },
    { label: "reftramo repetidos (filas)", value: staging.repeatedRows },
    { label: "reftramo no entero", value: staging.nonIntegerRefs },
    { label: "Geometría nula o vacía", value: staging.emptyGeometry },
    { label: "idcalle vacío", value: staging.emptyIdcalle },
    { label: "Filas con caracteres dañados", value: staging.damagedTextRows },
    { label: "Tipo de vialidad desconocido", value: staging.unknownTipoRows },
    { label: "Fuente desconocida", value: staging.unknownFuenteRows },
    { label: "Nuevos (NEW)", value: counts.newSections },
    { label: "Sin cambios (UNCHANGED)", value: counts.unchanged },
    { label: "Atributos (ATTR)", value: counts.attr },
    { label: "Geometría (GEOM)", value: counts.geom },
    { label: "Atributos y geometría", value: counts.both },
    { label: "Quitados (REMOVED)", value: counts.removed },
    { label: "Divisiones (SPLIT)", value: counts.splits },
    { label: "Uniones (MERGE)", value: counts.merges },
    { label: "Quitados sin reemplazo", value: counts.plainRemovals },
    { label: "Calles nuevas", value: counts.newStreets },
    { label: "cloc_iso con localidad", value: cloc.withLocality },
    { label: "cloc_iso solo departamento", value: cloc.onlyDepartment },
    { label: "cloc_iso sin código", value: cloc.withoutCode },
  ];
}

const summariesOf = (result: EjesResult): EjesListSummaries => ({
  splits: listSummaryOf("Divisiones (SPLIT)", result.splits.length, result.counts.splits),
  merges: listSummaryOf("Uniones (MERGE)", result.merges.length, result.counts.merges),
  plainRemovals: listSummaryOf("Quitados sin reemplazo", result.plainRemovals.length, result.counts.plainRemovals),
  newStreets: listSummaryOf("Calles nuevas", result.newStreets.length, result.counts.newStreets),
  attrChanges: listSummaryOf("Cambios de atributos (ATTR)", result.attrChanges.length, result.counts.attr),
});

export function buildEjesReportView(result: EjesResult): EjesReportView {
  const { timings, totalSeconds } = timingsViewOf(result.stepTimings);
  return {
    banners: [{ kind: "dryRun", text: EJES_DRY_RUN_BANNER }],
    kpis: kpisOf(result),
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
