import React, { useState } from "react";
import { Table, Search } from "lucide-react";
import { PaginationControls } from "@/components/shared/PaginationControls";
import { formatNumber } from "@/utils/common/ValueFormatter";
import styles from "./AttributeTable.module.css";

interface AttributeTableProps {
  records: Array<Record<string, unknown>>;
  attributes: string[];
  selectedIndex?: number | null;
  onSelectRow?: (index: number | null) => void;
}

const DEFAULT_PAGE_SIZE_OPTIONS = [15, 50, 100, 250];

export const AttributeTable: React.FC<AttributeTableProps> = ({
  records,
  attributes,
  selectedIndex,
  onSelectRow,
}) => {
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(15);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const indexedRecords = records.map((record, originalIndex) => ({ record, originalIndex }));

  const filteredRecords = searchQuery.trim()
    ? indexedRecords.filter(({ record }) =>
        attributes.some((attributeKey) => {
          const attributeValue = record[attributeKey];
          return (
            attributeValue !== undefined &&
            attributeValue !== null &&
            String(attributeValue).toLowerCase().includes(searchQuery.toLowerCase().trim())
          );
        })
      )
    : indexedRecords;

  const totalFilteredCount = filteredRecords.length;
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalFilteredCount);
  const paginatedRows = filteredRecords.slice(startIndex, endIndex);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
    setCurrentPage(1);
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
  };

  return (
    <div className={styles.tableContainer}>
      <div className={styles.tableHeaderBar}>
        <h4 className={styles.tableTitle}>
          <Table size={16} />
          <span>Tabla de Atributos ({formatNumber(totalFilteredCount)})</span>
        </h4>

        <div className={styles.searchBox}>
          <label htmlFor="attribute-table-search-input" className={styles.searchLabel}>
            <Search size={15} color="#94a3b8" />
            <span>Buscar:</span>
          </label>
          <input
            id="attribute-table-search-input"
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Filtrar atributos..."
            className={styles.searchInput}
          />
        </div>
      </div>

      <div className={styles.scrollArea}>
        {paginatedRows.length > 0 ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th key="#row">#</th>
                {attributes.map((attributeKey) => (
                  <th key={attributeKey}>{attributeKey}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginatedRows.map(({ record, originalIndex }, rowIndex) => {
                const globalIndex = startIndex + rowIndex + 1;
                const isSelected = selectedIndex === originalIndex;
                return (
                  <tr
                    key={originalIndex}
                    className={isSelected ? styles.selectedRow : undefined}
                    onClick={() => onSelectRow?.(isSelected ? null : originalIndex)}
                  >
                    <td key={`#-${originalIndex}`}>{globalIndex}</td>
                    {attributes.map((attributeKey) => {
                      const attributeValue = record[attributeKey];
                      const isNull =
                        attributeValue === null ||
                        attributeValue === undefined ||
                        String(attributeValue).trim() === "";
                      return (
                        <td key={attributeKey} title={!isNull ? String(attributeValue) : undefined}>
                          {isNull ? <span className={styles.nullVal}>null</span> : String(attributeValue)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className={styles.emptyMsg}>
            No se encontraron registros que coincidan con la búsqueda.
          </div>
        )}
      </div>

      <PaginationControls
        currentPage={safePage}
        totalPages={totalPages}
        pageSize={pageSize}
        totalFilteredCount={totalFilteredCount}
        startIndex={startIndex}
        endIndex={endIndex}
        pageSizeOptions={DEFAULT_PAGE_SIZE_OPTIONS}
        onPageChange={setCurrentPage}
        onPageSizeChange={handlePageSizeChange}
      />
    </div>
  );
};
