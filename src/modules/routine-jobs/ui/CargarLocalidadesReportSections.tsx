"use client";

import React from "react";
import type { CodeDifference, GeometryChange, InsertedLocality, LocalityKey, LocalitySkippedSample } from "../jobs/cargar-localidades/types";
import type { ReportBanner, ReportKpi, SkipReasonRow, TargetView, TimingView } from "./cargarLocalidadesReportView";
import { skipReasonLabelOf } from "./cargarLocalidadesReportView";
import { CollapsibleSection } from "./ActualizarReportSections";
import { DataTable } from "./DataTable";
import { keyedRowsOf } from "./keyedRows";
import { ReportRowList } from "./ReportRowList";
import sharedStyles from "./CargarPadronesReport.module.css";
import styles from "./ActualizarPadronReport.module.css";

const DECIMAL_PLACES = 2;
const AREA_DECIMAL_PLACES = 3;
const SECONDS_SUFFIX = "s";
const NO_DATA_TEXT = "sin dato";

const BANNER_CLASS: Record<ReportBanner["kind"], string> = {
  unknown: sharedStyles.bannerUnknown,
  dryRun: sharedStyles.bannerDryRun,
  done: sharedStyles.bannerDone,
};

const secondsText = (seconds: number): string => `${seconds.toFixed(DECIMAL_PLACES).replace(".", ",")} ${SECONDS_SUFFIX}`;

const textOrNoData = (value: string | null): string => value ?? NO_DATA_TEXT;

const localityNameOf = (key: LocalityKey): string => textOrNoData(key.name);

const localityKeyOf = (key: LocalityKey): string => `${key.department}|${key.name}`;

function SectionTitle({ children }: { children: string }) {
  return <h3 className={sharedStyles.sectionTitle}>{children}</h3>;
}

export function OutcomeBanners({ banners }: { banners: ReportBanner[] }) {
  return (
    <>
      {banners.map((banner) => (
        <div key={banner.kind} className={`${sharedStyles.banner} ${BANNER_CLASS[banner.kind]}`}>
          <p className={sharedStyles.bannerText}>{banner.text}</p>
        </div>
      ))}
    </>
  );
}

export function KpiCards({ kpis }: { kpis: ReportKpi[] }) {
  return (
    <section className={styles.kpis}>
      {kpis.map((kpi) => (
        <div key={kpi.label} className={styles.kpi}>
          <span className={styles.kpiLabel}>{kpi.label}</span>
          <strong className={styles.kpiValue}>{kpi.value}</strong>
        </div>
      ))}
    </section>
  );
}

function ReasonRow({ row }: { row: SkipReasonRow }) {
  return (
    <tr>
      <td>
        <div className={styles.reasonCell}>
          <span>{row.label}</span>
          <p className={styles.reasonHint}>{row.explanation}</p>
        </div>
      </td>
      <td>{row.value}</td>
      <td>{`${row.percent}%`}</td>
    </tr>
  );
}

export function SkippedReasonsSection({ rows, zeroReasonCount }: { rows: SkipReasonRow[]; zeroReasonCount: number }) {
  return (
    <section className={sharedStyles.section}>
      <SectionTitle>Filas omitidas por motivo</SectionTitle>
      {rows.length === 0 ? (
        <p className={sharedStyles.hint}>Ninguna fila fue omitida.</p>
      ) : (
        <div className={styles.tableWrap}>
          <DataTable headers={["Motivo", "Filas", "Porcentaje"]}>
            {rows.map((row) => (
              <ReasonRow key={row.reason} row={row} />
            ))}
          </DataTable>
        </div>
      )}
      {zeroReasonCount > 0 && <p className={styles.zeroNote}>{`Sin filas: ${zeroReasonCount} motivos`}</p>}
    </section>
  );
}

interface TableColumn<Row> {
  header: string;
  cell: (row: Row) => string;
}

/** Column headers are unique within a table, so they key the cells of each row. */
function RowsTable<Row>({ columns, rows, rowKey }: { columns: TableColumn<Row>[]; rows: Row[]; rowKey: (row: Row) => string }) {
  return (
    <div className={styles.tableWrap}>
      <DataTable headers={columns.map((column) => column.header)}>
        {keyedRowsOf(rows, rowKey).map(({ key, row }) => (
          <tr key={key}>
            {columns.map((column) => (
              <td key={column.header}>{column.cell(row)}</td>
            ))}
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

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

export function WarningsSection({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <section className={sharedStyles.section}>
      <SectionTitle>Advertencias</SectionTitle>
      <ul className={sharedStyles.list}>
        {warnings.map((warning, index) => (
          <li key={`${index}-${warning}`}>{warning}</li>
        ))}
      </ul>
    </section>
  );
}

export function TimingsSection({ timings, totalSeconds }: { timings: TimingView[]; totalSeconds: number }) {
  return (
    <CollapsibleSection summary="Tiempos por paso">
      <ul className={sharedStyles.list}>
        {timings.map((timing, index) => (
          <li key={`${index}-${timing.label}`}>{`${timing.label}: ${secondsText(timing.seconds)}`}</li>
        ))}
        <li className={sharedStyles.total}>{`Total: ${secondsText(totalSeconds)}`}</li>
      </ul>
    </CollapsibleSection>
  );
}
