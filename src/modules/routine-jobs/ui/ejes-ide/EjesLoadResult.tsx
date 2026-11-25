"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import type { EjesLoadReport, EjesResult, EjesSurplusRow } from "../../jobs/ejes-ide/types";
import { CollapsibleSection } from "../shared/CollapsibleSection";
import { buildEjesLoadView, type EjesSkippedView } from "./ejesLoadReportView";
import {
  EJES_LOAD_BACKUP_INSTRUCTIONS,
  EJES_LOAD_SKIPPED_BY_REASON_TITLE,
  EJES_LOAD_SKIPPED_TITLE,
  EJES_LOAD_SURPLUS_TITLE,
  EJES_LOAD_TITLE,
  skippedCapTextOf,
} from "./ejesLoadTexts";
import { OutcomeBanners, RowsTable, SectionTitle, type TableColumn } from "../shared/ReportParts";
import { ReportRowList } from "../shared/ReportRowList";
import { RefreshSuggestion } from "../shared/RefreshSuggestion";
import { RevertBackupSection } from "../shared/RevertBackupSection";
import sharedStyles from "../shared/ReportShared.module.css";

const SKIPPED_COLUMNS: TableColumn<EjesSkippedView>[] = [
  { header: "Tipo", cell: (row) => row.kind },
  { header: "Referencias", cell: (row) => row.refs },
  { header: "reftramo nuevos", cell: (row) => row.newRefs },
  { header: "Calle", cell: (row) => row.idcalle },
  { header: "Puntos", cell: (row) => row.points },
  { header: "Motivo", cell: (row) => row.reason },
];

const SURPLUS_COLUMNS: TableColumn<EjesSurplusRow>[] = [
  { header: "reftramo", cell: (row) => row.ref },
  { header: "Id", cell: (row) => row.id },
  { header: "Puntos", cell: (row) => String(row.points) },
];

export interface EjesLoadResultProps {
  result: EjesResult;
  load: EjesLoadReport;
}

export const EjesLoadResult: React.FC<EjesLoadResultProps> = ({ result, load }) => {
  const view = buildEjesLoadView(result, load);
  return (
    <div className={sharedStyles.report}>
      <SectionTitle>{EJES_LOAD_TITLE}</SectionTitle>
      <OutcomeBanners banners={view.banners} />
      {view.commitError !== null && <AlertMessage type={AlertType.ERROR} text={view.commitError} />}
      <section className={sharedStyles.section}>
        <ReportRowList rows={view.counts} />
      </section>
      {view.skippedTotal > 0 && (
        <CollapsibleSection summary={`${EJES_LOAD_SKIPPED_TITLE} (${view.skippedTotal})`}>
          <section className={sharedStyles.section}>
            <SectionTitle>{EJES_LOAD_SKIPPED_BY_REASON_TITLE}</SectionTitle>
            <ReportRowList rows={view.skippedByReason} />
          </section>
          {view.skipped.length < view.skippedTotal && <p>{skippedCapTextOf(view.skipped.length, view.skippedTotal)}</p>}
          <RowsTable columns={SKIPPED_COLUMNS} rows={view.skipped} rowKey={(row) => row.key} />
        </CollapsibleSection>
      )}
      {view.surplusTotal > 0 && (
        <CollapsibleSection summary={`${EJES_LOAD_SURPLUS_TITLE} (${view.surplusTotal})`}>
          <RowsTable columns={SURPLUS_COLUMNS} rows={view.surplus} rowKey={(row) => row.id} />
        </CollapsibleSection>
      )}
      {view.backup !== null && (
        <RevertBackupSection
          backup={view.backup}
          rows={[
            { label: "Tramos actualizados antes de la carga", value: view.backup.counts.updated },
            { label: "Tramos insertados", value: view.backup.counts.inserted },
            { label: "Vías insertadas", value: view.backup.counts.ways },
            { label: "Direcciones maestras insertadas", value: view.backup.counts.masters },
            { label: "Tramos borrados (se restauran)", value: view.backup.counts.deleted },
            { label: "Puntos de acceso movidos", value: view.backup.counts.pointsMoved },
          ]}
          instructions={EJES_LOAD_BACKUP_INSTRUCTIONS}
        />
      )}
      {view.nextStep !== null && <RefreshSuggestion suggestion={view.nextStep} />}
    </div>
  );
};
