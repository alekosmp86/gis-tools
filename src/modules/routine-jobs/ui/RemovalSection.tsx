"use client";

import React, { useMemo } from "react";
import type { PadronRemoved } from "../jobs/actualizar-padron/types";
import { CollapsibleSection } from "./ActualizarReportSections";
import { RowsTable, SectionTitle, type TableColumn } from "./ReportParts";
import { ReportRowList } from "./ReportRowList";
import { textOrNoData } from "./reportFormat";
import type { RemovalView } from "./removalReportView";
import { NUMBER_COLUMN, TYPE_COLUMN } from "./targetColumns";
import sharedStyles from "./CargarPadronesReport.module.css";

const REMOVED_COLUMNS: TableColumn<PadronRemoved>[] = [
  { header: "Id", cell: (padron) => String(padron.id) },
  TYPE_COLUMN,
  { header: "Provincia", cell: (padron) => textOrNoData(padron.department) },
  { header: "Localidad", cell: (padron) => textOrNoData(padron.locality) },
  NUMBER_COLUMN,
];

export function RemovalSection({ view }: { view: RemovalView }) {
  const columns = useMemo(() => [...REMOVED_COLUMNS, { header: "Estado", cell: () => view.statusLabel }], [view.statusLabel]);
  return (
    <section className={sharedStyles.section}>
      <SectionTitle>{view.headline}</SectionTitle>
      {view.reassignedNote !== null && <p className={sharedStyles.hint}>{view.reassignedNote}</p>}
      {view.blockedReason !== null && <p className={sharedStyles.hint}>{view.blockedReason}</p>}
      {view.notRemoved.length > 0 && <ReportRowList rows={view.notRemoved} />}
      {view.rows.length > 0 && (
        <CollapsibleSection summary={view.listSummary}>
          <RowsTable columns={columns} rows={view.rows} rowKey={(padron) => String(padron.id)} />
        </CollapsibleSection>
      )}
    </section>
  );
}
