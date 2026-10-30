"use client";

import React from "react";
import type { AddressMasterAmbiguous, AddressMasterLinked } from "../jobs/shared/addressMasterLinkPass";
import type { AddressMasterView } from "./addressMasterReportView";
import type { AddressMasterSubjectTexts } from "./addressMasterSubjectTexts";
import { CollapsibleSection } from "./ActualizarReportSections";
import { RowsTable, SectionTitle, type TableColumn } from "./ReportParts";
import { ReportRowList } from "./ReportRowList";
import { textOrNoData } from "./reportFormat";
import sharedStyles from "./CargarPadronesReport.module.css";

const CREATED_TEXT = "Creado";
const EXISTING_TEXT = "Ya existía";

type AddressMasterRow = AddressMasterLinked | AddressMasterAmbiguous;

const subjectColumnsOf = <Row extends AddressMasterRow>(texts: AddressMasterSubjectTexts): TableColumn<Row>[] => [
  { header: texts.idHeader, cell: (row) => String(row.id) },
  ...(texts.withDetails
    ? [
        { header: "Nombre", cell: (row: Row) => textOrNoData(row.name) },
        { header: "Provincia (id)", cell: (row: Row) => textOrNoData(row.provinceId) },
      ]
    : []),
];

const linkedColumnsOf = (texts: AddressMasterSubjectTexts): TableColumn<AddressMasterLinked>[] => [
  ...subjectColumnsOf<AddressMasterLinked>(texts),
  { header: "Id dirección maestra", cell: (row) => String(row.addressMasterId) },
  { header: "Registro", cell: (row) => (row.created ? CREATED_TEXT : EXISTING_TEXT) },
];

const ambiguousColumnsOf = (texts: AddressMasterSubjectTexts): TableColumn<AddressMasterAmbiguous>[] => [
  ...subjectColumnsOf<AddressMasterAmbiguous>(texts),
  { header: "Registros con su URN", cell: (row) => String(row.records) },
];

const rowKeyOf = (row: AddressMasterRow): string => String(row.id);

export interface AddressMasterSectionProps {
  view: AddressMasterView;
  texts: AddressMasterSubjectTexts;
}

export function AddressMasterSection({ view, texts }: AddressMasterSectionProps) {
  return (
    <section className={sharedStyles.section}>
      <SectionTitle>{view.table}</SectionTitle>
      <p className={sharedStyles.hint}>{texts.hint}</p>
      <ReportRowList rows={view.counts} />
      {view.linked.length > 0 && (
        <CollapsibleSection summary={view.linkedSummary}>
          <RowsTable columns={linkedColumnsOf(texts)} rows={view.linked} rowKey={rowKeyOf} />
        </CollapsibleSection>
      )}
      {view.ambiguous.length > 0 && (
        <CollapsibleSection summary={view.ambiguousSummary}>
          <RowsTable columns={ambiguousColumnsOf(texts)} rows={view.ambiguous} rowKey={rowKeyOf} />
        </CollapsibleSection>
      )}
    </section>
  );
}
