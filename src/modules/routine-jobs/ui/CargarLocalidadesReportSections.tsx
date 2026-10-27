"use client";

import React from "react";
import type { CodeDifference, GeometryChange, InsertedLocality, LocalityKey, LocalitySkippedSample } from "../jobs/cargar-localidades/types";
import type { TargetView } from "./cargarLocalidadesReportView";
import { skipReasonLabelOf } from "./cargarLocalidadesReportView";
import { CollapsibleSection } from "./ActualizarReportSections";
import { ReportRowList } from "./ReportRowList";
import { RowsTable, SectionTitle, type TableColumn } from "./ReportParts";
import { NO_DATA_TEXT, textOrNoData } from "./reportFormat";
import sharedStyles from "./CargarPadronesReport.module.css";

const DECIMAL_PLACES = 2;
const AREA_DECIMAL_PLACES = 3;

const localityNameOf = (key: LocalityKey): string => textOrNoData(key.name);

const localityKeyOf = (key: LocalityKey): string => `${key.department}|${key.name}`;

const SAMPLE_COLUMNS: TableColumn<LocalitySkippedSample>[] = [
  { header: "Departamento", cell: (sample) => textOrNoData(sample.department) },
  { header: "Localidad", cell: (sample) => textOrNoData(sample.locality) },
  { header: "Código", cell: (sample) => textOrNoData(sample.code) },
  { header: "Motivo", cell: (sample) => skipReasonLabelOf(sample.reason) },
];

const INSERTED_COLUMNS: TableColumn<InsertedLocality>[] = [
  { header: "Id", cell: (locality) => String(locality.id) },
  { header: "Departamento", cell: (locality) => textOrNoData(locality.department) },
  { header: "Localidad", cell: localityNameOf },
];

const GEOMETRY_COLUMNS: TableColumn<GeometryChange>[] = [
  { header: "Departamento", cell: (change) => textOrNoData(change.department) },
  { header: "Localidad", cell: localityNameOf },
  { header: "Distancia (m)", cell: (change) => (change.distance === null ? NO_DATA_TEXT : change.distance.toFixed(DECIMAL_PLACES)) },
  {
    header: "Proporción de área",
    cell: (change) => (change.areaRatio === null ? NO_DATA_TEXT : change.areaRatio.toFixed(AREA_DECIMAL_PLACES)),
  },
];

const LOCALITY_COLUMNS: TableColumn<LocalityKey>[] = [
  { header: "Departamento", cell: (locality) => textOrNoData(locality.department) },
  { header: "Localidad", cell: localityNameOf },
];

const CODE_COLUMNS: TableColumn<CodeDifference>[] = [
  { header: "Departamento", cell: (difference) => textOrNoData(difference.department) },
  { header: "Localidad", cell: localityNameOf },
  { header: "Código de origen", cell: (difference) => textOrNoData(difference.code) },
  { header: "Código destino", cell: (difference) => textOrNoData(difference.targetCode) },
];

export function SkippedSamplesDetails({ samples }: { samples: LocalitySkippedSample[] }) {
  if (samples.length === 0) return null;
  return (
    <CollapsibleSection summary={`Muestras de filas omitidas (${samples.length})`}>
      <RowsTable
        columns={SAMPLE_COLUMNS}
        rows={samples}
        rowKey={(sample) => `${sample.department}|${sample.locality}|${sample.code}|${sample.reason}`}
      />
    </CollapsibleSection>
  );
}

function InsertedDetails({ target }: { target: TargetView }) {
  if (target.inserted.length === 0) return null;
  return (
    <CollapsibleSection summary={`Localidades insertadas (${target.inserted.length})`}>
      <RowsTable columns={INSERTED_COLUMNS} rows={target.inserted} rowKey={(locality) => `${locality.id}`} />
    </CollapsibleSection>
  );
}

function GeometryDetails({ target }: { target: TargetView }) {
  if (target.geometryChanges.length === 0) return null;
  return (
    <CollapsibleSection summary={`Geometrías que cambian (${target.geometryChanges.length})`}>
      <RowsTable columns={GEOMETRY_COLUMNS} rows={target.geometryChanges} rowKey={localityKeyOf} />
    </CollapsibleSection>
  );
}

function MissingDetails({ target }: { target: TargetView }) {
  if (target.missing.length === 0) return null;
  return (
    <CollapsibleSection summary={`Faltantes en origen (${target.missing.length} muestras)`}>
      <RowsTable columns={LOCALITY_COLUMNS} rows={target.missing} rowKey={localityKeyOf} />
    </CollapsibleSection>
  );
}

function AmbiguousDetails({ target }: { target: TargetView }) {
  if (target.ambiguous.length === 0) return null;
  return (
    <CollapsibleSection summary={`Ambiguas (${target.ambiguous.length} muestras)`}>
      <RowsTable columns={LOCALITY_COLUMNS} rows={target.ambiguous} rowKey={localityKeyOf} />
    </CollapsibleSection>
  );
}

function CodeDifferDetails({ target }: { target: TargetView }) {
  if (target.codeDiffers.length === 0) return null;
  return (
    <CollapsibleSection summary={`Código distinto (${target.codeDiffers.length} muestras)`}>
      <RowsTable columns={CODE_COLUMNS} rows={target.codeDiffers} rowKey={localityKeyOf} />
    </CollapsibleSection>
  );
}

export function TargetSection({ target }: { target: TargetView }) {
  return (
    <section className={sharedStyles.section}>
      <SectionTitle>{target.table}</SectionTitle>
      {target.notes.map((note) => (
        <p key={note} className={sharedStyles.hint}>
          {note}
        </p>
      ))}
      <ReportRowList rows={target.counts} />
      <InsertedDetails target={target} />
      <GeometryDetails target={target} />
      <MissingDetails target={target} />
      <AmbiguousDetails target={target} />
      <CodeDifferDetails target={target} />
    </section>
  );
}
