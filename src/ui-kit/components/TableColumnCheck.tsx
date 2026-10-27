import React from "react";
import { AlertTriangle, Check, CheckCircle2 } from "lucide-react";
import type { ResolvedColumn } from "@/core/types/tableCatalog";
import { summarizeColumns, type ColumnRow } from "./tableSelectorLogic";
import styles from "./TableColumnCheck.module.css";

const ICON_SIZE = 14;
const ROW_ICON_SIZE = 13;

export interface TableColumnCheckProps {
  columns: readonly ResolvedColumn[];
}

export const TableColumnCheck: React.FC<TableColumnCheckProps> = ({ columns }) => {
  const summary = summarizeColumns(columns);
  return (
    <div className={styles.result}>
      <p className={summary.complete ? styles.chipOk : styles.chipBad} role="status">
        {summary.complete ? (
          <CheckCircle2 size={ICON_SIZE} aria-hidden="true" />
        ) : (
          <AlertTriangle size={ICON_SIZE} aria-hidden="true" />
        )}
        <span>{summary.label}</span>
      </p>
      {summary.problems.length > 0 && <ProblemList rows={summary.problems} />}
      {summary.rows.length > 0 && (
        <details className={styles.details}>
          <summary className={styles.detailsSummary}>{`Ver columnas (${summary.rows.length})`}</summary>
          <ul className={styles.columns}>
            {summary.rows.map((row) => (
              <ColumnItem key={row.logical} row={row} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

function ProblemList({ rows }: { rows: ColumnRow[] }) {
  return (
    <ul className={styles.problems}>
      {rows.map((row) => (
        <li key={row.logical} className={styles.problem}>
          <AlertTriangle size={ICON_SIZE} aria-hidden="true" className={styles.problemIcon} />
          <div className={styles.problemBody}>
            <p className={styles.problemHead}>
              <span className={styles.problemName}>{row.logical}</span>
              <span className={styles.pill}>{row.statusLabel}</span>
            </p>
            <p className={styles.problemDetail}>{row.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ColumnItem({ row }: { row: ColumnRow }) {
  return (
    <li className={styles.column}>
      <span
        role="img"
        aria-label={row.statusLabel}
        title={row.statusLabel}
        className={row.ok ? styles.iconOk : styles.iconBad}
      >
        {row.ok ? <Check size={ROW_ICON_SIZE} aria-hidden="true" /> : <AlertTriangle size={ROW_ICON_SIZE} aria-hidden="true" />}
      </span>
      <span className={styles.columnName}>{row.logical}</span>
      {row.ok ? (
        <span className={styles.realName} title={row.detail}>
          {row.detail}
        </span>
      ) : (
        <span className={`${styles.pill} ${styles.columnPill}`}>{row.statusLabel}</span>
      )}
    </li>
  );
}
