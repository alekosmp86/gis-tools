import { useState } from "react";
import type { DiscrepancyItem } from "@/core/types/comparison";
import { DiscrepancyFilter } from "@/core/types/comparison";
import { isSelectableEnabledItem } from "@/core/workers/comparison/DiscrepancySelection";

interface UseDiscrepanciesTableDataParams {
  items: DiscrepancyItem[];
  activeFilter: DiscrepancyFilter;
  searchQuery: string;
  primaryKeyColumn?: string | null;
}

function collectSelectableIds(
  rows: DiscrepancyItem[],
  primaryKeyColumn?: string | null
): string[] {
  return rows
    .filter((item) => isSelectableEnabledItem(item, primaryKeyColumn))
    .map((item) => item.id);
}

export const useDiscrepanciesTableData = ({
  items,
  activeFilter,
  searchQuery,
  primaryKeyColumn,
}: UseDiscrepanciesTableDataParams) => {
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [previousFilters, setPreviousFilters] = useState({ activeFilter, searchQuery });

  if (
    previousFilters.activeFilter !== activeFilter ||
    previousFilters.searchQuery !== searchQuery
  ) {
    setPreviousFilters({ activeFilter, searchQuery });
    setCurrentPage(1);
  }

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredItems = items.filter((item) => {
    const matchesFilter =
      activeFilter === DiscrepancyFilter.ALL || item.type === activeFilter;
    if (!matchesFilter) return false;

    if (normalizedQuery === "") return true;

    if (item.suid.toLowerCase().includes(normalizedQuery)) return true;
    if (item.note && item.note.toLowerCase().includes(normalizedQuery)) return true;

    return item.differences.some(
      (diffItem) =>
        diffItem.fieldName.toLowerCase().includes(normalizedQuery) ||
        (diffItem.dbValue !== null &&
          String(diffItem.dbValue).toLowerCase().includes(normalizedQuery)) ||
        (diffItem.shpValue !== null &&
          String(diffItem.shpValue).toLowerCase().includes(normalizedQuery))
    );
  });

  const totalFilteredCount = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / pageSize));
  const validCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (validCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalFilteredCount);
  const paginatedItems = filteredItems.slice(startIndex, endIndex);

  const filteredSelectableIds = collectSelectableIds(filteredItems, primaryKeyColumn);
  const pageSelectableIds = collectSelectableIds(paginatedItems, primaryKeyColumn);

  const paginationProps = {
    currentPage: validCurrentPage,
    totalPages,
    pageSize,
    totalFilteredCount,
    startIndex,
    endIndex,
    onPageChange: setCurrentPage,
    onPageSizeChange: (newPageSize: number) => {
      setPageSize(newPageSize);
      setCurrentPage(1);
    },
  };

  return {
    totalFilteredCount,
    paginatedItems,
    filteredSelectableIds,
    pageSelectableIds,
    paginationProps,
  };
};
