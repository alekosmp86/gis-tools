import type { CentrosBackup, CentrosComparisonRow, CentrosRepeatedRuee, CentrosResult } from "../jobs/centros-anep/types";
import {
  CENTROS_DONE_BANNER,
  CENTROS_DRY_RUN_BANNER,
  CENTROS_UNKNOWN_BANNER,
} from "./centrosAnepTexts";
import type { ReportBannerView, ReportKpiView, TimingItemView } from "./ReportParts";
import { listSummaryOf, outcomeBannersOf, timingsViewOf } from "./reportViewParts";

export interface CentrosAnepReportView {
  banners: ReportBannerView[];
  kpis: ReportKpiView[];
  comparisonRows: CentrosComparisonRow[];
  repeatedRows: CentrosRepeatedRuee[];
  repeatedSummary: string;
  blockers: string[];
  privilegeInfo: string[];
  columnInfo: string[];
  warnings: string[];
  backup: CentrosBackup | null;
  timings: TimingItemView[];
  totalSeconds: number;
}

function kpisOf(result: CentrosResult): ReportKpiView[] {
  const { staging, comparison } = result;
  const loadedKpis: ReportKpiView[] = result.dryRun
    ? []
    : [
        { label: "Filas eliminadas de la tabla final", value: result.deleted },
        { label: "Filas insertadas en la tabla final", value: result.inserted },
      ];
  return [
    { label: "Filas de staging", value: staging.rows },
    { label: "Filas ahora en la tabla final", value: comparison.currentRows },
    { label: "Filas en la tabla final después del reemplazo", value: comparison.afterRows },
    { label: "Geometría nula o vacía", value: staging.emptyGeometry },
    { label: "ruee nulo", value: staging.nullRuee },
    { label: "ruee repetidos (grupos)", value: staging.repeatedGroups },
    { label: "ruee repetidos (filas)", value: staging.repeatedRows },
    { label: "Subsistema nulo", value: staging.nullSubsistema },
    { label: "Filas con caracteres dañados", value: staging.damagedTextRows },
    ...loadedKpis,
  ];
}

export function buildCentrosAnepReportView(result: CentrosResult): CentrosAnepReportView {
  const { timings, totalSeconds } = timingsViewOf(result.stepTimings);
  return {
    banners: outcomeBannersOf(
      { dryRun: result.dryRun, outcomeUnknown: result.outcomeUnknown, modified: result.targetModified },
      { unknown: CENTROS_UNKNOWN_BANNER, dryRun: CENTROS_DRY_RUN_BANNER, done: CENTROS_DONE_BANNER }
    ),
    kpis: kpisOf(result),
    comparisonRows: result.comparison.bySubsistema,
    repeatedRows: result.staging.repeatedRuee,
    repeatedSummary: listSummaryOf("ruee repetidos", result.staging.repeatedRuee.length, result.staging.repeatedGroups),
    blockers: result.blockers,
    privilegeInfo: result.privilegeInfo,
    columnInfo: result.columnInfo,
    warnings: result.warnings,
    backup: result.backup ?? null,
    timings,
    totalSeconds,
  };
}

export const subsistemaTextOf = (value: string | null): string => value ?? "sin dato";

export const signedDifferenceOf = (difference: number): string => (difference > 0 ? `+${difference}` : String(difference));

