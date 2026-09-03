import React from "react";
import { Layers } from "lucide-react";
import { formatNumber } from "@/utils/common/ValueFormatter";
import { SearchInput } from "@/components/ui/SearchInput";
import styles from "./DiscrepanciesTable.module.css";

export interface DiscrepanciesTableHeaderProps {
  totalFilteredCount: number;
  totalItems: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export const DiscrepanciesTableHeader: React.FC<DiscrepanciesTableHeaderProps> = ({
  totalFilteredCount,
  totalItems,
  searchQuery,
  onSearchChange,
}) => {
  return (
    <div className={styles.tableHeaderRow}>
      <div className={styles.titleGroup}>
        <div className={styles.headerIcon}>
          <Layers size={18} />
        </div>
        <div>
          <div className={styles.tableTitle}>Resultados de Evaluación de Discrepancias</div>
          <div className={styles.tableSubtitle}>
            Mostrando <span className={styles.countCyan}>{formatNumber(totalFilteredCount)}</span> de{" "}
            <span className={styles.countMuted}>{formatNumber(totalItems)}</span> registros totales
          </div>
        </div>
      </div>

      <div className={styles.headerActions}>
        <div className={styles.searchWrapper}>
          <SearchInput
            value={searchQuery}
            onChange={onSearchChange}
            placeholder="Filtrar por SUID o atributo..."
          />
        </div>
      </div>
    </div>
  );
};
