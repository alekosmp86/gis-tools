"use client";

import React from "react";
import type { CargarLocalidadesResult } from "../jobs/cargar-localidades/types";
import { buildCargarLocalidadesReportView } from "./cargarLocalidadesReportView";
import { buildCargarLocalidadesCsv } from "./reportCsv/cargarLocalidadesCsv";
import { SkippedSamplesDetails, TargetBlocks } from "./CargarLocalidadesReportSections";
import { KpiCards, OutcomeBanners, SkippedReasonsSection, TimingsSection, WarningsSection } from "./ReportParts";
import { ReportDownloadButton } from "./ReportDownloadButton";
import { MonthlyStage } from "./monthlyCartoStages";
import sharedStyles from "./CargarPadronesReport.module.css";

export interface CargarLocalidadesReportProps {
  result: CargarLocalidadesResult;
}

export const CargarLocalidadesReport: React.FC<CargarLocalidadesReportProps> = ({ result }) => {
  const view = buildCargarLocalidadesReportView(result);

  return (
    <div className={sharedStyles.report}>
      <ReportDownloadButton
        stageSlug={MonthlyStage.CARGAR_LOCALIDADES}
        dryRun={result.dryRun}
        buildCsv={() => buildCargarLocalidadesCsv(result)}
      />
      <OutcomeBanners banners={view.banners} />
      <KpiCards kpis={view.kpis} />
      <SkippedReasonsSection rows={view.skippedRows} zeroReasonCount={view.zeroReasonCount} />
      <TargetBlocks targets={view.targets} />
      <SkippedSamplesDetails samples={view.skippedSamples} />
      <WarningsSection warnings={view.warnings} />
      <TimingsSection timings={view.timings} totalSeconds={view.totalSeconds} />
    </div>
  );
};
