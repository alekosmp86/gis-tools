"use client";

import React from "react";
import { formatNumber } from "@/core/common/ValueFormatter";
import type { RejectedFileGroup } from "../domain/planView";
import shared from "./AvanceShared.module.css";
import { AvanceTable } from "./AvanceTable";
import styles from "./RejectedFileTable.module.css";

interface RejectedFileTableProps {
  group: RejectedFileGroup;
}

/** The table shows the first rows only; the CSV download carries the whole (capped) list. */
const MAX_VISIBLE_ROWS = 100;

export const RejectedFileTable: React.FC<RejectedFileTableProps> = ({ group }) => {
  const visibleRows = group.rows.slice(0, MAX_VISIBLE_ROWS);
  const hiddenCount = group.rows.length - visibleRows.length;

  return (
    <div className={styles.wrapper}>
      <AvanceTable
        caption={`${group.file}: ${formatNumber(group.rows.length)} filas rechazadas listadas`}
        headers={["Línea", "Texto", "Motivo"]}
      >
        {visibleRows.map((row) => (
          <tr key={`${row.file}-${row.line}`}>
            <td className={shared.numeric}>{row.line}</td>
            <td className={styles.rawText}>{row.text}</td>
            <td>{row.reason}</td>
          </tr>
        ))}
      </AvanceTable>
      {hiddenCount > 0 && (
        <p className={styles.more}>y {formatNumber(hiddenCount)} más (descargue el CSV para verlas todas)</p>
      )}
    </div>
  );
};
