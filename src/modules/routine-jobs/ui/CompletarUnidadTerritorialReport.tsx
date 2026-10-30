"use client";

import React from "react";
import type {
  CompletarAmbiguousUnit,
  CompletarLinkedUnit,
  CompletarResult,
  CompletarUnitKey,
} from "../jobs/completar-unidad-territorial/types";
import { CollapsibleSection } from "./ActualizarReportSections";
import { RefreshSuggestion } from "./RefreshSuggestion";
import { ReportDownloadActions, ReportDownloadButton } from "./ReportDownloadButton";
import { ReportRowList } from "./ReportRowList";
import { OutcomeBanners, RowsTable, SectionTitle, TimingsSection, WarningsSection, type TableColumn } from "./ReportParts";
import { textOrNoData } from "./reportFormat";
import { buildCompletarUnidadTerritorialCsv } from "./reportCsv/completarUnidadTerritorialCsv";
import { MonthlyStage } from "./monthlyCartoStages";
import { buildCompletarReportView } from "./completarUnidadTerritorialReportView";
import sharedStyles from "./CargarPadronesReport.module.css";

const CREATED_TEXT = "Creado";
const EXISTING_TEXT = "Ya existía";

const UNIT_COLUMNS: TableColumn<CompletarUnitKey>[] = [
  { header: "Id", cell: (unit) => String(unit.id) },
  { header: "Nombre", cell: (unit) => textOrNoData(unit.name) },
  { header: "Provincia (id)", cell: (unit) => textOrNoData(unit.provinceId) },
];

const LINKED_COLUMNS: TableColumn<CompletarLinkedUnit>[] = [
  ...UNIT_COLUMNS,
  { header: "Id dirección maestra", cell: (unit) => String(unit.addressMasterId) },
  { header: "Registro", cell: (unit) => (unit.created ? CREATED_TEXT : EXISTING_TEXT) },
];

const AMBIGUOUS_COLUMNS: TableColumn<CompletarAmbiguousUnit>[] = [
  ...UNIT_COLUMNS,
  { header: "Registros con su URN", cell: (unit) => String(unit.records) },
];

const unitKeyOf = (unit: CompletarUnitKey): string => String(unit.id);

export interface CompletarUnidadTerritorialReportProps {
  result: CompletarResult;
}

export const CompletarUnidadTerritorialReport: React.FC<CompletarUnidadTerritorialReportProps> = ({ result }) => {
  const view = buildCompletarReportView(result);
  return (
    <div className={sharedStyles.report}>
      <ReportDownloadActions>
        <ReportDownloadButton
          stageSlug={MonthlyStage.COMPLETAR_UNIDAD_TERRITORIAL}
          dryRun={result.dryRun}
          buildCsv={() => buildCompletarUnidadTerritorialCsv(result)}
        />
      </ReportDownloadActions>
      <OutcomeBanners banners={view.banners} />
      <section className={sharedStyles.section}>
        <SectionTitle>{view.unitTable}</SectionTitle>
        <p className={sharedStyles.hint}>{`Registros de dirección maestra en ${view.addressMasterTable}.`}</p>
        <ReportRowList rows={view.counts} />
        {view.linked.length > 0 && (
          <CollapsibleSection summary={`Unidades enlazadas (${view.linked.length})`}>
            <RowsTable columns={LINKED_COLUMNS} rows={view.linked} rowKey={unitKeyOf} />
          </CollapsibleSection>
        )}
        {view.ambiguous.length > 0 && (
          <CollapsibleSection summary={`Ambiguas (${view.ambiguous.length} muestras)`}>
            <RowsTable columns={AMBIGUOUS_COLUMNS} rows={view.ambiguous} rowKey={unitKeyOf} />
          </CollapsibleSection>
        )}
      </section>
      {view.suggestion !== null && <RefreshSuggestion suggestion={view.suggestion} />}
      <WarningsSection warnings={view.warnings} />
      <TimingsSection timings={view.timings} totalSeconds={view.totalSeconds} />
    </div>
  );
};
