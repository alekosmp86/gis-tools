"use client";

import React from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import type { JobGates } from "../job/types.ts";
import { gateRows } from "../domain/shpJobView";
import styles from "./ShpGateTable.module.css";

interface ShpGateTableProps {
  gates: JobGates;
}

export const ShpGateTable: React.FC<ShpGateTableProps> = ({ gates }) => (
  <table className={styles.table}>
    <caption>Verificaciones de calidad: {gates.passed ? "superadas" : "no superadas"}</caption>
    <tbody>
      {gateRows(gates).map((row) => (
        <tr key={row.label}>
          <td>
            {row.passed ? <CheckCircle2 size={15} className={styles.ok} /> : <XCircle size={15} className={styles.failed} />}
          </td>
          <td>{row.label}</td>
          <td className={styles.value}>{row.value}</td>
        </tr>
      ))}
    </tbody>
  </table>
);
