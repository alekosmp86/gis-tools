"use client";

import React from "react";
import { formatNumber } from "@/core/common/ValueFormatter";
import type { TableMetrics, TestReport } from "../job/types.ts";
import styles from "./ShpMetricsTable.module.css";

interface ShpMetricsTableProps {
  report: TestReport;
}

const METRIC_ROWS: ReadonlyArray<{ label: string; pick: (metrics: TableMetrics) => number }> = [
  { label: "Filas", pick: (metrics) => metrics.rows },
  { label: "Vértices", pick: (metrics) => metrics.vertices },
  { label: "Área (m²)", pick: (metrics) => metrics.area },
];

/** What the table holds today, what the file would leave in it, and the difference. */
export const ShpMetricsTable: React.FC<ShpMetricsTableProps> = ({ report }) => (
  <table className={styles.table}>
    <caption>Comparación de la prueba (la tabla no fue modificada)</caption>
    <thead>
      <tr>
        <th scope="col">Métrica</th>
        <th scope="col">Actual</th>
        <th scope="col">Con el archivo</th>
        <th scope="col">Diferencia</th>
      </tr>
    </thead>
    <tbody>
      {METRIC_ROWS.map((row) => (
        <tr key={row.label}>
          <td>{row.label}</td>
          <td>{formatNumber(row.pick(report.current))}</td>
          <td>{formatNumber(row.pick(report.new))}</td>
          <td>{formatNumber(row.pick(report.diff))}</td>
        </tr>
      ))}
    </tbody>
  </table>
);
