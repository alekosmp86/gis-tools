import React from "react";
import { formatNumber } from "@/utils/formatters";
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
          {title} ({formatNumber(columns.length)}):
        </span>
        {totalRows !== null && (
          <span className={styles.rowCount}>
            Total registros: {formatNumber(totalRows)}
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
