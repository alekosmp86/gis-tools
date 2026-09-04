import { useState } from "react";
import type { DiscrepancyItem } from "@/types/comparison";
import { DiscrepancyFilter } from "@/types/comparison";

interface UseDiscrepanciesTableDataParams {
  items: DiscrepancyItem[];
  activeFilter: DiscrepancyFilter;
  searchQuery: string;
}

export const useDiscrepanciesTableData = ({
  items,
  activeFilter,
  searchQuery,
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
    paginationProps,
  };
};
