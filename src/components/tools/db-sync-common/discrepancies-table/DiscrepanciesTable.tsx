import React from "react";
import type {
  DiscrepancyItem,
  DiscrepancyFilter,
  ComparisonSourceDescriptor,
} from "@/core/types/comparison";
import { SelectionCheckState } from "@/core/types/selection";
import { countSelectedIn, resolveCheckState } from "@/core/selection/selectionReducer";
import { isSelectionBlockedItem } from "@/core/workers/comparison/DiscrepancySelection";
import { PaginationControls } from "@/ui-kit/components/PaginationControls";
import { useDiscrepanciesTableData } from "./useDiscrepanciesTableData";
import { DiscrepanciesTableHeader } from "./DiscrepanciesTableHeader";
import { DiscrepanciesTableHead } from "./DiscrepanciesTableHead";
import { DiscrepanciesSelectionBar } from "./DiscrepanciesSelectionBar";
import type { DiscrepancySelectionController } from "./useDiscrepancySelection";
import { DiscrepancyItemRows } from "./DiscrepancyItemRows";
import { DiscrepanciesTableEmpty } from "./DiscrepanciesTableEmpty";
import styles from "./DiscrepanciesTable.module.css";

export interface DiscrepanciesTableProps {
  items: DiscrepancyItem[];
  activeFilter: DiscrepancyFilter;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  descriptor: ComparisonSourceDescriptor;
  selection: DiscrepancySelectionController;
  primaryKeyColumn?: string | null;
}

export const DiscrepanciesTable: React.FC<DiscrepanciesTableProps> = ({
  items,
  activeFilter,
  searchQuery,
  onSearchChange,
  descriptor,
  selection,
  primaryKeyColumn,
}) => {
  const {
    totalFilteredCount,
    paginatedItems,
    filteredSelectableIds,
    pageSelectableIds,
    paginationProps,
  } = useDiscrepanciesTableData({
    items,
    activeFilter,
    searchQuery,
    primaryKeyColumn,
  });

  const selectedOnPageCount = countSelectedIn(selection.selectedIds, pageSelectableIds);
  const pageCheckState = resolveCheckState(selectedOnPageCount, pageSelectableIds.length);
  const handleTogglePage = () => {
    if (pageCheckState === SelectionCheckState.ALL) {
      selection.deselect(pageSelectableIds);
    } else {
      selection.select(pageSelectableIds);
    }
  };

  return (
    <div className={styles.tableContainer}>
      <DiscrepanciesTableHeader
        totalFilteredCount={totalFilteredCount}
        totalItems={items.length}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
      />

      <DiscrepanciesSelectionBar
        selectedCount={selection.selectedIds.size}
        selectableCount={selection.selectableCount}
        selectedInFilterCount={countSelectedIn(selection.selectedIds, filteredSelectableIds)}
        hasSelectableOnPage={pageSelectableIds.length > 0}
        hasSelectableInFilter={filteredSelectableIds.length > 0}
        onSelectPage={() => selection.select(pageSelectableIds)}
        onSelectFiltered={() => selection.select(filteredSelectableIds)}
        onDeselectPage={() => selection.deselect(pageSelectableIds)}
        onClear={selection.clear}
      />

      <PaginationControls {...paginationProps} />

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <DiscrepanciesTableHead
            descriptor={descriptor}
            pageCheckState={pageCheckState}
            hasSelectableOnPage={pageSelectableIds.length > 0}
            onTogglePage={handleTogglePage}
          />
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
                  isSelected={selection.selectedIds.has(item.id)}
                  isSelectionBlocked={isSelectionBlockedItem(item, primaryKeyColumn)}
                  onToggleSelect={selection.toggle}
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
