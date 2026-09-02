import React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { formatNumber } from "@/utils/common/ValueFormatter";
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
        Mostrando <span className={styles.highlightNumber}>{formatNumber(startIndex + 1)}</span> –{" "}
        <span className={styles.highlightNumber}>{formatNumber(endIndex)}</span> de{" "}
        <span className={styles.highlightTotal}>{formatNumber(totalFilteredCount)}</span> registros
      </div>

      <div className={styles.paginationControls}>
        <div className={styles.pageSizeGroup}>
          <label htmlFor="page-size-select" className={styles.pageSizeLabel}>
            Filas por página:
          </label>
          <div className={styles.selectWrapper}>
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
        </div>

        <div className={styles.pageButtons}>
          <button
            type="button"
            className={styles.pageBtn}
            onClick={() => onPageChange(1)}
            disabled={currentPage === 1}
            title="Primera página"
            aria-label="Primera página"
          >
            <ChevronsLeft size={16} />
          </button>

          <button
            type="button"
            className={styles.pageBtn}
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            title="Página anterior"
            aria-label="Página anterior"
          >
            <ChevronLeft size={16} />
          </button>

          <div className={styles.pageIndicator}>
            <span>Página</span>
            <span className={styles.currentPageBadge}>{currentPage}</span>
            <span>de</span>
            <span className={styles.totalPagesText}>{formatNumber(totalPages)}</span>
          </div>

          <button
            type="button"
            className={styles.pageBtn}
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            title="Página siguiente"
            aria-label="Página siguiente"
          >
            <ChevronRight size={16} />
          </button>

          <button
            type="button"
            className={styles.pageBtn}
            onClick={() => onPageChange(totalPages)}
            disabled={currentPage === totalPages}
            title="Última página"
            aria-label="Última página"
          >
            <ChevronsRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
