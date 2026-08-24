import React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import type { PaginationControlsProps } from "@/types/ui";
import styles from "./PaginationControls.module.css";

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
        Mostrando <strong>{(startIndex + 1).toLocaleString("es-UY")}</strong> -{" "}
        <strong>{endIndex.toLocaleString("es-UY")}</strong> de{" "}
        <strong>{totalFilteredCount.toLocaleString("es-UY")}</strong> registros
      </div>

      <div className={styles.paginationControls}>
        <div className={styles.pageSizeGroup}>
          <label htmlFor="page-size-select">Filas por página:</label>
          <select
            id="page-size-select"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
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
