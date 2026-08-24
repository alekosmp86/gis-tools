import React from "react";
import type { ColumnsListProps } from "@/types/ui";
import styles from "./ColumnsList.module.css";

export const ColumnsList: React.FC<ColumnsListProps> = ({
  columns,
  totalRows = null,
  title = "Columnas Disponibles",
  className = "",
}) => {
  return (
    <div className={`${styles.columnsContainer} ${className}`}>
      <div className={styles.columnsHeader}>
        <span className={styles.columnsTitle}>
          {title} ({columns.length}):
        </span>
        {totalRows !== null && (
          <span className={styles.rowCount}>
            Total registros: {totalRows.toLocaleString()}
          </span>
        )}
      </div>

      <div className={styles.columnTags}>
        {columns.map((col) => (
          <span key={col} className={styles.colTag}>
            {col}
          </span>
        ))}
      </div>
    </div>
  );
};
