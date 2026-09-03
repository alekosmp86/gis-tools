import React from "react";
import { AlertTriangle } from "lucide-react";
import styles from "./DiscrepanciesTable.module.css";

export const DiscrepanciesTableEmpty: React.FC = () => {
  return (
    <tr>
      <td colSpan={5} className={styles.emptyRow}>
        <div className={styles.emptyContent}>
          <AlertTriangle size={26} className={styles.emptyIcon} />
          <div className={styles.emptyTitle}>No se encontraron registros</div>
          <div className={styles.emptySubtitle}>
            No hay discrepancias que coincidan con los filtros aplicados o el término de búsqueda.
          </div>
        </div>
      </td>
    </tr>
  );
};
