"use client";

import React from "react";
import type { CargarLocalidadesResult } from "../jobs/cargar-localidades/types";
import { buildCargarLocalidadesReportView } from "./cargarLocalidadesReportView";
import { buildCargarLocalidadesCsv, buildCargarLocalidadesInconsistenciasCsv } from "./reportCsv/cargarLocalidadesCsv";
import { REPORT_CSV_KIND } from "./reportCsv/filename";
import { SkippedSamplesDetails, TargetBlocks, UnmatchedPadronDetails } from "./CargarLocalidadesReportSections";
import { KpiCards, OutcomeBanners, SkippedReasonsSection, TimingsSection, WarningsSection } from "./ReportParts";
import { ReportDownloadActions, ReportDownloadButton } from "./ReportDownloadButton";
import { MonthlyStage } from "./monthlyCartoStages";
import sharedStyles from "./CargarPadronesReport.module.css";

export interface CargarLocalidadesReportProps {
  result: CargarLocalidadesResult;
}

export const CargarLocalidadesReport: React.FC<CargarLocalidadesReportProps> = ({ result }) => {
  const view = buildCargarLocalidadesReportView(result);

  return (
    <div className={sharedStyles.report}>
      <ReportDownloadActions>
        <ReportDownloadButton
          stageSlug={MonthlyStage.CARGAR_LOCALIDADES}
          dryRun={result.dryRun}
          buildCsv={() => buildCargarLocalidadesCsv(result)}
        />
        {view.unmatchedPadrons.length > 0 && (
          <ReportDownloadButton
            stageSlug={MonthlyStage.CARGAR_LOCALIDADES}
            dryRun={result.dryRun}
            kind={REPORT_CSV_KIND.INCONSISTENCIES}
            buildCsv={() => buildCargarLocalidadesInconsistenciasCsv(result)}
          />
        )}
      </ReportDownloadActions>
      <OutcomeBanners banners={view.banners} />
      <KpiCards kpis={view.kpis} />
      <SkippedReasonsSection rows={view.skippedRows} zeroReasonCount={view.zeroReasonCount} />
      <TargetBlocks targets={view.targets} />
      <UnmatchedPadronDetails padrones={view.unmatchedPadrons} total={view.unmatchedPadronTotal} />
      <SkippedSamplesDetails samples={view.skippedSamples} />
      <WarningsSection warnings={view.warnings} />
      <TimingsSection timings={view.timings} totalSeconds={view.totalSeconds} />
    </div>
  );
};
