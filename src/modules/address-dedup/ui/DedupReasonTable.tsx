"use client";

import React from "react";
import { formatNumber } from "@/core/common/ValueFormatter";
import {
  DECISION_LABELS,
  REASON_DESCRIPTIONS,
  REASON_LABELS,
  REASONS_BY_DECISION,
  SUMMARY_DECISIONS,
} from "../data/dedupLabels";
import { percentOf } from "../domain/summaryView";
import type { DedupSummary } from "../types";
import shared from "./DedupShared.module.css";
import styles from "./DedupReasonTable.module.css";

interface DedupReasonTableProps {
  summary: DedupSummary;
}

export const DedupReasonTable: React.FC<DedupReasonTableProps> = ({ summary }) => (
  <section className={`glass-panel ${styles.panel}`}>
    <h3 className={styles.title}>Motivos</h3>
    <div className={styles.scroller}>
      <table className={styles.table}>
        <caption className={shared.visuallyHidden}>Filas por motivo de decisión</caption>
        <thead>
          <tr>
            <th scope="col">Motivo</th>
            <th scope="col" className={styles.number}>
              Filas
            </th>
            <th scope="col" className={styles.number}>
              % del total
            </th>
            <th scope="col">Proporción</th>
          </tr>
        </thead>
        {SUMMARY_DECISIONS.map((decision) => (
          <tbody key={decision}>
            <tr className={styles.sectionRow}>
              <th scope="colgroup" colSpan={4}>
                {DECISION_LABELS[decision]}
              </th>
            </tr>
            {REASONS_BY_DECISION[decision].map((reason) => {
              const count = summary.byReason[reason] ?? 0;
              const percent = percentOf(count, summary.rowCount);
              return (
                <tr key={reason} className={count === 0 ? styles.zero : undefined}>
                  <th scope="row" className={styles.reasonCell} title={REASON_DESCRIPTIONS[reason]}>
                    {REASON_LABELS[reason]}
                  </th>
                  <td className={styles.number}>{formatNumber(count)}</td>
                  <td className={styles.number}>{percent.toLocaleString("es-UY")}%</td>
                  <td>
                    <progress
                      className={styles.bar}
                      max={100}
                      value={percent}
                      aria-label={`${REASON_LABELS[reason]}: ${percent}%`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  </section>
);
