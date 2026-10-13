"use client";

import React from "react";
import { formatNumber } from "@/core/common/ValueFormatter";
import type { RejectedFileGroup } from "../domain/planView";
import shared from "./IndicatorsShared.module.css";
import styles from "./RejectedFileTable.module.css";

interface RejectedFileTableProps {
  group: RejectedFileGroup;
}

/** The table shows the first rows only; the CSV download carries all of them. */
const MAX_VISIBLE_ROWS = 100;

export const RejectedFileTable: React.FC<RejectedFileTableProps> = ({ group }) => {
  const visibleRows = group.rows.slice(0, MAX_VISIBLE_ROWS);
  const hiddenCount = group.rows.length - visibleRows.length;

  return (
    <div className={styles.wrapper}>
      <table className={shared.table}>
        <caption>
          {group.file}: {formatNumber(group.rows.length)} filas rechazadas
        </caption>
        <thead>
          <tr>
            <th scope="col">Línea</th>
            <th scope="col">Texto</th>
            <th scope="col">Motivo</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr key={`${row.file}-${row.line}`}>
              <td className={shared.numeric}>{row.line}</td>
              <td className={styles.rawText}>{row.text}</td>
              <td>{row.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {hiddenCount > 0 && (
        <p className={styles.more}>
          y {formatNumber(hiddenCount)} más (descargue el CSV para verlas todas)
        </p>
      )}
    </div>
  );
};
