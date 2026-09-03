import React from "react";
import type {
  DiscrepancyItem,
  DiscrepancyFilter,
  ComparisonSourceDescriptor,
} from "@/types/comparison";
import { PaginationControls } from "@/components/shared/PaginationControls";
import { useDiscrepanciesTableData } from "./useDiscrepanciesTableData";
import { DiscrepanciesTableHeader } from "./DiscrepanciesTableHeader";
import { DiscrepanciesTableHead } from "./DiscrepanciesTableHead";
import { DiscrepancyItemRows } from "./DiscrepancyItemRows";
import { DiscrepanciesTableEmpty } from "./DiscrepanciesTableEmpty";
import styles from "./DiscrepanciesTable.module.css";

export interface DiscrepanciesTableProps {
  items: DiscrepancyItem[];
  activeFilter: DiscrepancyFilter;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  descriptor: ComparisonSourceDescriptor;
}

export const DiscrepanciesTable: React.FC<DiscrepanciesTableProps> = ({
  items,
  activeFilter,
  searchQuery,
  onSearchChange,
  descriptor,
}) => {
  const { totalFilteredCount, paginatedItems, paginationProps } = useDiscrepanciesTableData({
    items,
    activeFilter,
    searchQuery,
  });

  return (
    <div className={styles.tableContainer}>
      <DiscrepanciesTableHeader
        totalFilteredCount={totalFilteredCount}
        totalItems={items.length}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
      />

      <PaginationControls {...paginationProps} />

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <DiscrepanciesTableHead descriptor={descriptor} />
          <tbody>
            {paginatedItems.length === 0 ? (
              <DiscrepanciesTableEmpty />
            ) : (
              paginatedItems.map((item) => (
                <DiscrepancyItemRows
                  key={item.id}
                  item={item}
                  descriptor={descriptor}
                  activeFilter={activeFilter}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginationControls {...paginationProps} />
    </div>
  );
};
