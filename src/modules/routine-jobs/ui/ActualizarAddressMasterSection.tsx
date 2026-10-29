"use client";

import React from "react";
import type { AddressMasterAmbiguous, AddressMasterLinked } from "../jobs/shared/addressMasterLinkPass";
import type { AddressMasterView } from "./actualizarPadronReportView";
import { CollapsibleSection } from "./ActualizarReportSections";
import { RowsTable, SectionTitle, type TableColumn } from "./ReportParts";
import { ReportRowList } from "./ReportRowList";
import sharedStyles from "./CargarPadronesReport.module.css";

const HINT = "Direcciones maestras de los padrones: se crean y se enlazan en la misma transacción que la actualización.";
const CREATED_TEXT = "Creado";
const EXISTING_TEXT = "Ya existía";

const PADRON_ID_COLUMN: TableColumn<AddressMasterLinked | AddressMasterAmbiguous> = {
  header: "Id padrón",
  cell: (padron) => String(padron.id),
};

const LINKED_COLUMNS: TableColumn<AddressMasterLinked>[] = [
  PADRON_ID_COLUMN,
  { header: "Id dirección maestra", cell: (padron) => String(padron.addressMasterId) },
  { header: "Registro", cell: (padron) => (padron.created ? CREATED_TEXT : EXISTING_TEXT) },
];

const AMBIGUOUS_COLUMNS: TableColumn<AddressMasterAmbiguous>[] = [
  PADRON_ID_COLUMN,
  { header: "Registros con su URN", cell: (padron) => String(padron.records) },
];

const padronKeyOf = (padron: AddressMasterLinked | AddressMasterAmbiguous): string => String(padron.id);

export function ActualizarAddressMasterSection({ view }: { view: AddressMasterView }) {
  return (
    <section className={sharedStyles.section}>
      <SectionTitle>{view.table}</SectionTitle>
      <p className={sharedStyles.hint}>{HINT}</p>
      <ReportRowList rows={view.counts} />
      {view.linked.length > 0 && (
        <CollapsibleSection summary={view.linkedSummary}>
          <RowsTable columns={LINKED_COLUMNS} rows={view.linked} rowKey={padronKeyOf} />
        </CollapsibleSection>
      )}
      {view.ambiguous.length > 0 && (
        <CollapsibleSection summary={view.ambiguousSummary}>
          <RowsTable columns={AMBIGUOUS_COLUMNS} rows={view.ambiguous} rowKey={padronKeyOf} />
        </CollapsibleSection>
      )}
    </section>
  );
}
