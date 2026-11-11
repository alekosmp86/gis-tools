"use client";

import React from "react";
import type { EjesMergeRow, EjesNewStreetRow, EjesRemovalRow, EjesResult, EjesSplitRow } from "../jobs/ejes-calles/types";
import { CollapsibleSection } from "./ActualizarReportSections";
import { buildEjesReportView, coverageTextOf, type EjesAttrRowView } from "./ejesCallesReportView";
import { KpiCards, OutcomeBanners, RowsTable, SectionTitle, TimingsSection, type TableColumn } from "./ReportParts";
import { textOrNoData } from "./reportFormat";
import sharedStyles from "./CargarPadronesReport.module.css";

const SPLIT_COLUMNS: TableColumn<EjesSplitRow>[] = [
  { header: "reftramo quitado", cell: (row) => row.oldRef },
  { header: "idcalle", cell: (row) => textOrNoData(row.idcalle) },
  { header: "reftramo nuevos", cell: (row) => row.newRefs.join(", ") },
  { header: "Puntos de acceso", cell: (row) => String(row.points) },
  { header: "Cobertura", cell: (row) => coverageTextOf(row.coverage) },
];

const MERGE_COLUMNS: TableColumn<EjesMergeRow>[] = [
  { header: "reftramo nuevo", cell: (row) => row.newRef },
  { header: "idcalle", cell: (row) => textOrNoData(row.idcalle) },
  { header: "reftramo quitados", cell: (row) => row.oldRefs.join(", ") },
  { header: "Puntos de acceso", cell: (row) => String(row.points) },
  { header: "Cobertura", cell: (row) => coverageTextOf(row.coverage) },
];

const REMOVAL_COLUMNS: TableColumn<EjesRemovalRow>[] = [
  { header: "reftramo", cell: (row) => row.ref },
  { header: "idcalle", cell: (row) => textOrNoData(row.idcalle) },
  { header: "Puntos de acceso", cell: (row) => String(row.points) },
  { header: "Qué pasa", cell: (row) => (row.points > 0 ? "No se quita: tiene puntos de acceso" : "Se quita") },
];

const STREET_COLUMNS: TableColumn<EjesNewStreetRow>[] = [
  { header: "idcalle", cell: (row) => textOrNoData(row.idcalle) },
  { header: "Nombre", cell: (row) => textOrNoData(row.name) },
  { header: "Tramos nuevos", cell: (row) => String(row.sections) },
];

const ATTR_COLUMNS: TableColumn<EjesAttrRowView>[] = [
  { header: "reftramo", cell: (row) => row.ref },
  { header: "Cambia", cell: (row) => row.changes },
  { header: "Nombre actual", cell: (row) => textOrNoData(row.currentName) },
  { header: "Nombre nuevo", cell: (row) => textOrNoData(row.name) },
  { header: "idcalle actual", cell: (row) => textOrNoData(row.currentIdcalle) },
  { header: "idcalle nuevo", cell: (row) => textOrNoData(row.idcalle) },
];

const LIST_SECTION_TITLE = "Listas";

function TextList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className={sharedStyles.section}>
      <SectionTitle>{title}</SectionTitle>
      <ul className={sharedStyles.list}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export interface EjesCallesReportProps {
  result: EjesResult;
}

export const EjesCallesReport: React.FC<EjesCallesReportProps> = ({ result }) => {
  const view = buildEjesReportView(result);
  return (
    <div className={sharedStyles.report}>
      <OutcomeBanners banners={view.banners} />
      {view.kpiGroups.map((group) => (
        <section key={group.title} className={sharedStyles.section}>
          <SectionTitle>{group.title}</SectionTitle>
          {group.kpis.length > 0 ? <KpiCards kpis={group.kpis} /> : <p>{group.emptyText}</p>}
        </section>
      ))}
      <TextList title="Bloqueos para la carga" items={view.blockers} />
      <TextList title="Privilegios de escritura (información del análisis)" items={view.privilegeInfo} />
      <section className={sharedStyles.section}>
        <SectionTitle>{LIST_SECTION_TITLE}</SectionTitle>
        {result.splits.length > 0 && (
          <CollapsibleSection summary={view.summaries.splits}>
            <RowsTable columns={SPLIT_COLUMNS} rows={result.splits} rowKey={(row) => row.oldRef} />
          </CollapsibleSection>
        )}
        {result.merges.length > 0 && (
          <CollapsibleSection summary={view.summaries.merges}>
            <RowsTable columns={MERGE_COLUMNS} rows={result.merges} rowKey={(row) => row.newRef} />
          </CollapsibleSection>
        )}
        {result.plainRemovals.length > 0 && (
          <CollapsibleSection summary={view.summaries.plainRemovals}>
            <RowsTable columns={REMOVAL_COLUMNS} rows={result.plainRemovals} rowKey={(row) => row.ref} />
          </CollapsibleSection>
        )}
        {result.newStreets.length > 0 && (
          <CollapsibleSection summary={view.summaries.newStreets}>
            <RowsTable columns={STREET_COLUMNS} rows={result.newStreets} rowKey={(row) => `${row.idcalle}|${row.name}`} />
          </CollapsibleSection>
        )}
        {view.attrRows.length > 0 && (
          <CollapsibleSection summary={view.summaries.attrChanges}>
            <RowsTable columns={ATTR_COLUMNS} rows={view.attrRows} rowKey={(row) => row.ref} />
          </CollapsibleSection>
        )}
      </section>
      <TextList title="Tipos de vialidad fuera de la tabla" items={view.unknownTipos} />
      <TextList title="Fuentes fuera de la tabla" items={view.unknownFuentes} />
      <TimingsSection timings={view.timings} totalSeconds={view.totalSeconds} />
    </div>
  );
};
