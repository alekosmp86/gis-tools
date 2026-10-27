"use client";

import React from "react";
import type {
  ActualizarReportView,
  GroupRow,
  GroupSplit,
  LocalityRow,
  SkippedReasonRow,
} from "./actualizarPadronReportView";
import { DataTable } from "./DataTable";
import { ReportRowList } from "./ReportRowList";
import styles from "./ActualizarPadronReport.module.css";
import sharedStyles from "./CargarPadronesReport.module.css";

const DECIMAL_PLACES = 2;
const SECONDS_SUFFIX = "s";

const secondsText = (seconds: number): string => `${seconds.toFixed(DECIMAL_PLACES).replace(".", ",")} ${SECONDS_SUFFIX}`;

const barClassOf = (barStep: number): string => styles[`fill${barStep}`];

interface KeyedRow<Row> {
  key: string;
  row: Row;
}

function keyedRowsOf<Row>(rows: Row[], contentOf: (row: Row) => string): KeyedRow<Row>[] {
  const occurrences = new Map<string, number>();
  return rows.map((row) => {
    const content = contentOf(row);
    const occurrence = occurrences.get(content) ?? 0;
    occurrences.set(content, occurrence + 1);
    return { key: `${content}#${occurrence}`, row };
  });
}

const groupRowsOf = (groups: GroupRow[]) => groups.map((group) => ({ label: group.name, value: group.count }));

function SectionTitle({ children }: { children: string }) {
  return <h3 className={sharedStyles.sectionTitle}>{children}</h3>;
}

function ReasonBar({ row }: { row: SkippedReasonRow }) {
  return (
    <div className={styles.barTrack}>
      <span className={`${styles.bar} ${barClassOf(row.barStep)}`} data-bar-step={row.barStep} />
    </div>
  );
}

export function SkippedReasonsTable({ view }: { view: ActualizarReportView }) {
  return (
    <section className={sharedStyles.section}>
      <SectionTitle>Filas omitidas por motivo</SectionTitle>
      <div className={styles.tableWrap}>
        <DataTable headers={["Motivo", "Filas", "Porcentaje", "Proporción"]}>
          {view.skippedRows.map((row) => (
            <tr key={row.reason}>
              <td>
                <div className={styles.reasonCell}>
                  <span>{row.label}</span>
                  <p className={styles.reasonHint}>{row.hint}</p>
                </div>
              </td>
              <td>{row.value}</td>
              <td>{`${row.percent}%`}</td>
              <td>
                <ReasonBar row={row} />
              </td>
            </tr>
          ))}
        </DataTable>
      </div>
      {view.zeroReasonCount > 0 && <p className={styles.zeroNote}>{`Sin filas: ${view.zeroReasonCount} motivos`}</p>}
    </section>
  );
}

export function GroupTopList({ title, split }: { title: string; split: GroupSplit }) {
  if (split.top.length === 0) return null;
  return (
    <section className={sharedStyles.section}>
      <SectionTitle>{title}</SectionTitle>
      <div className={styles.tableWrap}>
        <ReportRowList rows={groupRowsOf(split.top)} />
      </div>
      {split.restCount > 0 && (
        <details className={styles.details}>
          <summary className={styles.summary}>{`Ver todo (${split.restCount})`}</summary>
          <div className={`${styles.detailsBody} ${styles.tableWrap}`}>
            <ReportRowList rows={groupRowsOf(split.rest)} />
          </div>
        </details>
      )}
    </section>
  );
}

export function LocalityTable({ title, rows }: { title: string; rows: LocalityRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className={sharedStyles.section}>
      <SectionTitle>{title}</SectionTitle>
      <div className={styles.tableWrap}>
        <DataTable headers={["Departamento", "Localidad", "Padrones"]}>
          {keyedRowsOf(rows, (row) => `${row.department}|${row.locality}`).map(({ key, row }) => (
            <tr key={key}>
              <td>{row.department}</td>
              <td>{row.locality}</td>
              <td>{row.count}</td>
            </tr>
          ))}
        </DataTable>
      </div>
    </section>
  );
}

export function CollapsibleSection({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className={styles.details}>
      <summary className={styles.summary}>{summary}</summary>
      <div className={styles.detailsBody}>{children}</div>
    </details>
  );
}

export function SampleTable({ view }: { view: ActualizarReportView }) {
  const rows = keyedRowsOf(view.samples, (sample) => `${sample.department}|${sample.locality}|${sample.padron}|${sample.reason}`);
  return (
    <div className={styles.tableWrap}>
      <DataTable headers={["Departamento", "Localidad", "Padrón", "Motivo"]}>
        {rows.map(({ key, row }) => (
          <tr key={key}>
            <td>{row.department}</td>
            <td>{row.locality}</td>
            <td>{row.padron}</td>
            <td>{row.reason}</td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

export function CollidingKeyList({ view }: { view: ActualizarReportView }) {
  const hidden = view.collidingKeyCount - view.collidingKeys.length;
  return (
    <>
      <p className={sharedStyles.hint}>{`Claves con más de una fila: ${view.collidingKeyCount}. Todas sus filas se omiten.`}</p>
      <ul className={sharedStyles.list}>
        {view.collidingKeys.map((key, index) => (
          <li key={`${index}-${key.keyLabel}`}>{`${key.keyLabel}: ${key.rows} filas`}</li>
        ))}
      </ul>
      {hidden > 0 && <p className={sharedStyles.hint}>{`y ${hidden} más`}</p>}
    </>
  );
}

export function TimingList({ view }: { view: ActualizarReportView }) {
  return (
    <ul className={sharedStyles.list}>
      {view.timings.map((timing, index) => (
        <li key={`${index}-${timing.label}`}>{`${timing.label}: ${secondsText(timing.seconds)}`}</li>
      ))}
      <li className={sharedStyles.total}>{`Total: ${secondsText(view.totalSeconds)}`}</li>
    </ul>
  );
}
