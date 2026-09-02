import React from "react";
import { formatNumber } from "@/utils/common/ValueFormatter";
import styles from "./ColumnsList.module.css";

export interface ColumnsListProps {
  columns: string[];
  totalRows?: number | null;
  title?: string;
  className?: string;
}

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
        {columns.map((column) => (
          <span key={column} className={styles.colTag}>
            {column}
          </span>
        ))}
      </div>
    </div>
  );
};
