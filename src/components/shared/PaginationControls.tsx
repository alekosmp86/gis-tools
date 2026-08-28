import React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { formatNumber } from "@/utils/formatters";
import styles from "./PaginationControls.module.css";

export interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalFilteredCount: number;
  startIndex: number;
  endIndex: number;
  pageSizeOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

const DEFAULT_PAGE_SIZE_OPTIONS = [50, 100, 250, 500];

export const PaginationControls: React.FC<PaginationControlsProps> = ({
  currentPage,
  totalPages,
  pageSize,
  totalFilteredCount,
  startIndex,
  endIndex,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  onPageChange,
  onPageSizeChange,
}) => {
  if (totalFilteredCount === 0) return null;

  return (
    <div className={styles.paginationBar}>
      <div className={styles.paginationSummary}>
        Mostrando <strong>{formatNumber(startIndex + 1)}</strong> -{" "}
        <strong>{formatNumber(endIndex)}</strong> de{" "}
        <strong>{formatNumber(totalFilteredCount)}</strong> registros
      </div>

      <div className={styles.paginationControls}>
        <div className={styles.pageSizeGroup}>
          <label htmlFor="page-size-select">Filas por página:</label>
          <select
            id="page-size-select"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className={styles.pageSizeSelect}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.pageButtons}>
          <button
            type="button"
            className={styles.pageBtn}
            onClick={() => onPageChange(1)}
            disabled={currentPage === 1}
            title="Primera página"
          >
            <ChevronsLeft size={16} />
          </button>

          <button
            type="button"
            className={styles.pageBtn}
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            title="Página anterior"
          >
            <ChevronLeft size={16} />
          </button>

          <span className={styles.pageIndicator}>
            Página <strong>{currentPage}</strong> de <strong>{totalPages}</strong>
          </span>

          <button
            type="button"
            className={styles.pageBtn}
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            title="Página siguiente"
          >
            <ChevronRight size={16} />
          </button>

          <button
            type="button"
            className={styles.pageBtn}
            onClick={() => onPageChange(totalPages)}
            disabled={currentPage === totalPages}
            title="Última página"
          >
            <ChevronsRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
