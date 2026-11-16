import React from "react";
import type { ReportRowTone } from "./reportRowTone";
import styles from "./CargarPadronesReport.module.css";

export interface ReportRowListRow {
  label: string;
  value: number;
  tone?: ReportRowTone;
}

export function ReportRowList({ rows }: { rows: ReportRowListRow[] }) {
  return (
    <dl className={styles.rows}>
      {rows.map((row) => (
        <div key={row.label} className={styles.row} data-tone={row.tone}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
