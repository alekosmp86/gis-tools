import React from "react";
import { formatNumber } from "@/core/common/ValueFormatter";
import type {
  AttributeConflictSample,
  GroupKeyValues,
  LargestGroup,
  OverlapSample,
} from "@/core/types/geometryProcessing";
import styles from "./GeometryReport.module.css";

const NULL_TEXT = "NULL";

const formatGroupKey = (key: GroupKeyValues): string =>
  Object.entries(key)
    .map(([column, value]) => `${column} = ${value ?? NULL_TEXT}`)
    .join(", ");

const formatArea = (area: number): string =>
  area.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface ReportSectionProps {
  title: string;
  count: number;
  children: React.ReactNode;
}

export const ReportSection: React.FC<ReportSectionProps> = ({ title, count, children }) => (
  <details className={styles.section}>
    <summary className={styles.sectionSummary}>
      {title} ({formatNumber(count)})
    </summary>
    <div className={styles.tableWrapper}>{children}</div>
  </details>
);

export interface AttributeConflictsTableProps {
  samples: ReadonlyArray<AttributeConflictSample>;
}

export const AttributeConflictsTable: React.FC<AttributeConflictsTableProps> = ({ samples }) => (
  <table className={styles.table}>
    <thead>
      <tr>
        <th>Clave</th>
        <th>Columna</th>
        <th>Valores (conservado marcado)</th>
      </tr>
    </thead>
    <tbody>
      {samples.flatMap((sample) =>
        sample.columns.map((column) => (
          <tr key={`${formatGroupKey(sample.key)}-${column.column}`}>
            <td className={styles.mono}>{formatGroupKey(sample.key)}</td>
            <td className={styles.mono}>{column.column}</td>
            <td>
              {column.distinctValues.map((value) => {
                const isKept = value === column.keptValue;
                return (
                  <span key={value ?? NULL_TEXT} className={isKept ? styles.keptValue : styles.value}>
                    {value ?? NULL_TEXT}
                    {isKept ? " (conservado)" : ""}
                  </span>
                );
              })}
            </td>
          </tr>
        ))
      )}
    </tbody>
  </table>
);

export interface OverlapsTableProps {
  samples: ReadonlyArray<OverlapSample>;
}

export const OverlapsTable: React.FC<OverlapsTableProps> = ({ samples }) => (
  <table className={styles.table}>
    <thead>
      <tr>
        <th>Registro A</th>
        <th>Registro B</th>
        <th>Área (m²)</th>
        <th>Clave A</th>
        <th>Clave B</th>
      </tr>
    </thead>
    <tbody>
      {samples.map((sample) => (
        <tr key={`${sample.recA}-${sample.recB}`}>
          <td>{formatNumber(sample.recA)}</td>
          <td>{formatNumber(sample.recB)}</td>
          <td>{formatArea(sample.area)}</td>
          <td className={styles.mono}>{formatGroupKey(sample.keyA)}</td>
          <td className={styles.mono}>{formatGroupKey(sample.keyB)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

export interface LargestGroupsTableProps {
  groups: ReadonlyArray<LargestGroup>;
}

export const LargestGroupsTable: React.FC<LargestGroupsTableProps> = ({ groups }) => (
  <table className={styles.table}>
    <thead>
      <tr>
        <th>Clave</th>
        <th>Registros</th>
      </tr>
    </thead>
    <tbody>
      {groups.map((group) => (
        <tr key={formatGroupKey(group.key)}>
          <td className={styles.mono}>{formatGroupKey(group.key)}</td>
          <td>{formatNumber(group.size)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);
