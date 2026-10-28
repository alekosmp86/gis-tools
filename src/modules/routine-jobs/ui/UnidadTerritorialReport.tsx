"use client";

import React from "react";
import type { UnitGeometryChange, UnitInserted, UnitKey, UnitResult, UnitSkippedSample } from "../jobs/unidad-territorial/types";
import { CollapsibleSection } from "./ActualizarReportSections";
import { ReportRowList } from "./ReportRowList";
import {
  KpiCards,
  OutcomeBanners,
  RowsTable,
  SectionTitle,
  SkippedReasonsSection,
  TimingsSection,
  WarningsSection,
  type TableColumn,
} from "./ReportParts";
import { NO_DATA_TEXT, textOrNoData } from "./reportFormat";
import { ReportDownloadButton } from "./ReportDownloadButton";
import { buildUnidadTerritorialCsv } from "./reportCsv/unidadTerritorialCsv";
import { MonthlyStage } from "./monthlyCartoStages";
import { buildUnitReportView, unitSkipReasonLabelOf, type UnitReportTargetView } from "./unidadTerritorialReportView";
import sharedStyles from "./CargarPadronesReport.module.css";

const DECIMAL_PLACES = 2;
const AREA_DECIMAL_PLACES = 3;

const unitKeyOf = (key: UnitKey): string => `${key.provinceId}|${key.name}`;

const nameOf = (key: UnitKey): string => textOrNoData(key.name);

const provinceOf = (key: UnitKey): string => textOrNoData(key.provinceId);

const SAMPLE_COLUMNS: TableColumn<UnitSkippedSample>[] = [
  { header: "Nombre", cell: (sample) => textOrNoData(sample.name) },
  { header: "Provincia (id)", cell: (sample) => textOrNoData(sample.provinceId) },
  { header: "Motivo", cell: (sample) => unitSkipReasonLabelOf(sample.reason) },
];

const KEY_COLUMNS: TableColumn<UnitKey>[] = [
  { header: "Nombre", cell: nameOf },
  { header: "Provincia (id)", cell: provinceOf },
];

const INSERTED_COLUMNS: TableColumn<UnitInserted>[] = [
  { header: "Id", cell: (unit) => String(unit.id) },
  { header: "Nombre", cell: nameOf },
  { header: "Provincia (id)", cell: provinceOf },
];

const GEOMETRY_COLUMNS: TableColumn<UnitGeometryChange>[] = [
  { header: "Nombre", cell: nameOf },
  { header: "Provincia (id)", cell: provinceOf },
  { header: "Distancia (m)", cell: (change) => (change.distance === null ? NO_DATA_TEXT : change.distance.toFixed(DECIMAL_PLACES)) },
  {
    header: "Proporción de área",
    cell: (change) => (change.areaRatio === null ? NO_DATA_TEXT : change.areaRatio.toFixed(AREA_DECIMAL_PLACES)),
  },
];

function UnitDetails({ target }: { target: UnitReportTargetView }) {
  return (
    <>
      {target.inserted.length > 0 && (
        <CollapsibleSection summary={`Unidades insertadas (${target.inserted.length})`}>
          <RowsTable columns={INSERTED_COLUMNS} rows={target.inserted} rowKey={(unit) => `${unit.id}`} />
        </CollapsibleSection>
      )}
      {target.geometryChanges.length > 0 && (
        <CollapsibleSection summary={`Geometrías que cambian (${target.geometryChanges.length})`}>
          <RowsTable columns={GEOMETRY_COLUMNS} rows={target.geometryChanges} rowKey={unitKeyOf} />
        </CollapsibleSection>
      )}
      {target.missing.length > 0 && (
        <CollapsibleSection summary={`Faltantes en origen (${target.missing.length} muestras)`}>
          <RowsTable columns={KEY_COLUMNS} rows={target.missing} rowKey={unitKeyOf} />
        </CollapsibleSection>
      )}
      {target.ambiguous.length > 0 && (
        <CollapsibleSection summary={`Ambiguas (${target.ambiguous.length} muestras)`}>
          <RowsTable columns={KEY_COLUMNS} rows={target.ambiguous} rowKey={unitKeyOf} />
        </CollapsibleSection>
      )}
    </>
  );
}

function TargetSection({ target }: { target: UnitReportTargetView }) {
  return (
    <section className={sharedStyles.section}>
      <SectionTitle>{target.table}</SectionTitle>
      {target.notes.map((note) => (
        <p key={note} className={sharedStyles.hint}>
          {note}
        </p>
      ))}
      <ReportRowList rows={target.counts} />
      <UnitDetails target={target} />
    </section>
  );
}

export interface UnidadTerritorialReportProps {
  result: UnitResult;
}

export const UnidadTerritorialReport: React.FC<UnidadTerritorialReportProps> = ({ result }) => {
  const view = buildUnitReportView(result);
  return (
    <div className={sharedStyles.report}>
      <ReportDownloadButton
        stageSlug={MonthlyStage.UNIDAD_TERRITORIAL}
        dryRun={result.dryRun}
        buildCsv={() => buildUnidadTerritorialCsv(result)}
      />
      <OutcomeBanners banners={view.banners} />
      <KpiCards kpis={view.kpis} />
      <SkippedReasonsSection rows={view.skippedRows} zeroReasonCount={view.zeroReasonCount} />
      <TargetSection target={view.target} />
      {view.skippedSamples.length > 0 && (
        <CollapsibleSection summary={`Muestras de filas omitidas (${view.skippedSamples.length})`}>
          <RowsTable
            columns={SAMPLE_COLUMNS}
            rows={view.skippedSamples}
            rowKey={(sample) => `${sample.name}|${sample.provinceId}|${sample.reason}`}
          />
        </CollapsibleSection>
      )}
      <WarningsSection warnings={view.warnings} />
      <TimingsSection timings={view.timings} totalSeconds={view.totalSeconds} />
    </div>
  );
};
