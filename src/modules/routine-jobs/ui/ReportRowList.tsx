import React from "react";
import styles from "./CargarPadronesReport.module.css";

export interface ReportRowListRow {
  label: string;
  value: number;
}

export function ReportRowList({ rows }: { rows: ReportRowListRow[] }) {
  return (
    <dl className={styles.rows}>
      {rows.map((row) => (
        <div key={row.label} className={styles.row}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
