"use client";

import React from "react";
import { CheckCircle2, Trash2 } from "lucide-react";
import { formatNumber } from "@/core/common/ValueFormatter";
import { Decision } from "../constants";
import { DECISION_LABELS, MATRIX_COLUMNS, SUMMARY_DECISIONS } from "../data/dedupLabels";
import { cellCount, columnTotal, decisionTotal } from "../domain/summaryView";
import type { DedupSummary } from "../types";
import shared from "./DedupShared.module.css";
import styles from "./DedupDecisionMatrix.module.css";

interface DedupDecisionMatrixProps {
  summary: DedupSummary;
}

const NumberCell: React.FC<{ value: number; isTotal?: boolean }> = ({ value, isTotal = false }) => (
  <td className={`${styles.number} ${value === 0 ? styles.zero : ""} ${isTotal ? styles.total : ""}`}>
    {formatNumber(value)}
  </td>
);

export const DedupDecisionMatrix: React.FC<DedupDecisionMatrixProps> = ({ summary }) => (
  <section className={`glass-panel ${styles.panel}`}>
    <h3 className={styles.title}>Decisión por fuente</h3>
    <div className={styles.scroller}>
      <table className={styles.table}>
        <caption className={shared.visuallyHidden}>Filas por decisión y fuente</caption>
        <thead>
          <tr>
            <th scope="col">Decisión</th>
            {MATRIX_COLUMNS.map(({ column, label }) => (
              <th key={column} scope="col" className={styles.number}>
                {label}
              </th>
            ))}
            <th scope="col" className={styles.number}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {SUMMARY_DECISIONS.map((decision) => (
            <tr key={decision}>
              <th scope="row" className={styles.rowHeader}>
                {decision === Decision.REMOVE ? (
                  <Trash2 size={14} className={styles.removeIcon} />
                ) : (
                  <CheckCircle2 size={14} className={styles.keepIcon} />
                )}
                {DECISION_LABELS[decision]}
              </th>
              {MATRIX_COLUMNS.map(({ column }) => (
                <NumberCell key={column} value={cellCount(summary, decision, column)} />
              ))}
              <NumberCell value={decisionTotal(summary, decision)} isTotal />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className={styles.rowHeader}>
              Total
            </th>
            {MATRIX_COLUMNS.map(({ column }) => (
              <NumberCell key={column} value={columnTotal(summary, column)} isTotal />
            ))}
            <NumberCell value={summary.rowCount} isTotal />
          </tr>
        </tfoot>
      </table>
    </div>
  </section>
);
