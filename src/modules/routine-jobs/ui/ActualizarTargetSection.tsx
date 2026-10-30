"use client";

import React from "react";
import type { PadronGeometryChange, PadronInserted, PadronKey, PadronNamedKey } from "../jobs/actualizar-padron/types";
import type { PairView, TargetView } from "./actualizarPadronReportView";
import { CollapsibleSection } from "./ActualizarReportSections";
import { RowsTable, SectionTitle, type TableColumn } from "./ReportParts";
import { ReportRowList } from "./ReportRowList";
import { NO_DATA_TEXT, textOrNoData } from "./reportFormat";
import sharedStyles from "./CargarPadronesReport.module.css";

const DECIMAL_PLACES = 2;
const AREA_DECIMAL_PLACES = 3;

const idOrNoData = (value: number | null): string => (value === null ? NO_DATA_TEXT : String(value));

const keyContentOf = (key: PadronKey): string => `${key.typePadron}|${key.provinceId}|${key.localityId}|${key.number}`;

const TYPE_COLUMN: TableColumn<PadronKey> = { header: "Tipo", cell: (key) => textOrNoData(key.typePadron) };
const NUMBER_COLUMN: TableColumn<PadronKey> = { header: "Padrón", cell: (key) => textOrNoData(key.number) };

const KEY_COLUMNS: TableColumn<PadronKey>[] = [
  TYPE_COLUMN,
  { header: "Provincia (id)", cell: (key) => idOrNoData(key.provinceId) },
  { header: "Localidad (id)", cell: (key) => idOrNoData(key.localityId) },
  NUMBER_COLUMN,
];

const NAMED_COLUMNS: TableColumn<PadronNamedKey>[] = [
  TYPE_COLUMN,
  { header: "Provincia", cell: (key) => textOrNoData(key.department) },
  { header: "Localidad", cell: (key) => textOrNoData(key.locality) },
  NUMBER_COLUMN,
];

const INSERTED_COLUMNS: TableColumn<PadronInserted>[] = [{ header: "Id", cell: (padron) => String(padron.id) }, ...NAMED_COLUMNS];

const GEOMETRY_COLUMNS: TableColumn<PadronGeometryChange>[] = [
  ...NAMED_COLUMNS,
  {
    header: "Distancia (m)",
    cell: (change) => (change.distance === null ? NO_DATA_TEXT : change.distance.toFixed(DECIMAL_PLACES)),
  },
  {
    header: "Proporción de área",
    cell: (change) => (change.areaRatio === null ? NO_DATA_TEXT : change.areaRatio.toFixed(AREA_DECIMAL_PLACES)),
  },
];

const PAIR_COLUMNS: TableColumn<PairView>[] = [
  { header: "Departamento", cell: (pair) => pair.department },
  { header: "Localidad anterior", cell: (pair) => pair.oldLocality },
  { header: "Localidad nueva", cell: (pair) => pair.newLocality },
  { header: "Tipo anterior", cell: (pair) => pair.oldType },
  { header: "Tipo nuevo", cell: (pair) => pair.newType },
  { header: "Padrón anterior", cell: (pair) => pair.oldNumber },
  { header: "Padrón nuevo", cell: (pair) => pair.newNumber },
  {
    header: "Distancia (m)",
    cell: (pair) => (pair.distance === null ? NO_DATA_TEXT : pair.distance.toFixed(DECIMAL_PLACES)),
  },
  { header: "Estado", cell: (pair) => pair.status },
];

function TargetDetails({ target }: { target: TargetView }) {
  return (
    <>
      {target.inserted.length > 0 && (
        <CollapsibleSection summary={target.insertedSummary}>
          <RowsTable columns={INSERTED_COLUMNS} rows={target.inserted} rowKey={(padron) => `${padron.id}`} />
        </CollapsibleSection>
      )}
      {target.geometryChanges.length > 0 && (
        <CollapsibleSection summary={target.geometryChangesSummary}>
          <RowsTable columns={GEOMETRY_COLUMNS} rows={target.geometryChanges} rowKey={keyContentOf} />
        </CollapsibleSection>
      )}
      {target.pairs.length > 0 && (
        <CollapsibleSection summary={target.pairsSummary}>
          <RowsTable columns={PAIR_COLUMNS} rows={target.pairs} rowKey={(pair) => pair.key} />
        </CollapsibleSection>
      )}
      {target.missing.length > 0 && (
        <CollapsibleSection summary={target.missingSummary}>
          <RowsTable columns={KEY_COLUMNS} rows={target.missing} rowKey={keyContentOf} />
        </CollapsibleSection>
      )}
      {target.ambiguous.length > 0 && (
        <CollapsibleSection summary={target.ambiguousSummary}>
          <RowsTable columns={KEY_COLUMNS} rows={target.ambiguous} rowKey={keyContentOf} />
        </CollapsibleSection>
      )}
    </>
  );
}

export function ActualizarTargetSection({ target }: { target: TargetView }) {
  return (
    <section className={sharedStyles.section}>
      <SectionTitle>{target.table}</SectionTitle>
      {target.notes.map((note) => (
        <p key={note} className={sharedStyles.hint}>
          {note}
        </p>
      ))}
      <ReportRowList rows={target.counts} />
      <TargetDetails target={target} />
    </section>
  );
}
