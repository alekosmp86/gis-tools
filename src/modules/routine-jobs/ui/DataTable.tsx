import React from "react";
import styles from "./CargarPadronesReport.module.css";

export interface DataTableProps {
  headers: ReadonlyArray<string>;
  children: React.ReactNode;
}

export function DataTable({ headers, children }: DataTableProps) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          {headers.map((header) => (
            <th key={header}>{header}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}
