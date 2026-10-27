"use client";

import React from "react";
import { CollapsibleSection } from "./ActualizarReportSections";
import { DataTable } from "./DataTable";
import { keyedRowsOf } from "./keyedRows";
import { secondsText } from "./reportFormat";
import sharedStyles from "./CargarPadronesReport.module.css";
import styles from "./ActualizarPadronReport.module.css";

export type ReportBannerKind = "unknown" | "dryRun" | "done";

export interface ReportBannerView {
  kind: ReportBannerKind;
  text: string;
}

export interface ReportKpiView {
  label: string;
  value: number;
}

export interface SkipReasonView {
  reason: string;
  label: string;
  explanation: string;
  value: number;
  percent: number;
}

export interface TimingItemView {
  label: string;
  seconds: number;
}

const BANNER_CLASS: Record<ReportBannerKind, string> = {
  unknown: sharedStyles.bannerUnknown,
  dryRun: sharedStyles.bannerDryRun,
  done: sharedStyles.bannerDone,
};

export function SectionTitle({ children }: { children: string }) {
  return <h3 className={sharedStyles.sectionTitle}>{children}</h3>;
}

export function OutcomeBanners({ banners }: { banners: ReportBannerView[] }) {
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

export function KpiCards({ kpis }: { kpis: ReportKpiView[] }) {
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

function ReasonRow({ row }: { row: SkipReasonView }) {
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

export function SkippedReasonsSection({ rows, zeroReasonCount }: { rows: SkipReasonView[]; zeroReasonCount: number }) {
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

export interface TableColumn<Row> {
  header: string;
  cell: (row: Row) => string;
}

/** Column headers are unique within a table, so they key the cells of each row. */
export function RowsTable<Row>({ columns, rows, rowKey }: { columns: TableColumn<Row>[]; rows: Row[]; rowKey: (row: Row) => string }) {
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

export function TimingsSection({ timings, totalSeconds }: { timings: TimingItemView[]; totalSeconds: number }) {
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
