"use client";

import React from "react";
import type { CargarLocalidadesResult } from "../jobs/cargar-localidades/types";
import { buildCargarLocalidadesReportView } from "./cargarLocalidadesReportView";
import { SkippedSamplesDetails, TargetSection } from "./CargarLocalidadesReportSections";
import { KpiCards, OutcomeBanners, SkippedReasonsSection, TimingsSection, WarningsSection } from "./ReportParts";
import sharedStyles from "./CargarPadronesReport.module.css";

export interface CargarLocalidadesReportProps {
  result: CargarLocalidadesResult;
}

export const CargarLocalidadesReport: React.FC<CargarLocalidadesReportProps> = ({ result }) => {
  const view = buildCargarLocalidadesReportView(result);

  return (
    <div className={sharedStyles.report}>
      <OutcomeBanners banners={view.banners} />
      <KpiCards kpis={view.kpis} />
      <SkippedReasonsSection rows={view.skippedRows} zeroReasonCount={view.zeroReasonCount} />
      {view.targets.map((target) => (
        <TargetSection key={target.table} target={target} />
      ))}
      <SkippedSamplesDetails samples={view.skippedSamples} />
      <WarningsSection warnings={view.warnings} />
      <TimingsSection timings={view.timings} totalSeconds={view.totalSeconds} />
    </div>
  );
};
