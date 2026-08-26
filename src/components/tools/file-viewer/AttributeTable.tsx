import React, { useState } from "react";
import { Table, Search } from "lucide-react";
import { PaginationControls } from "@/components/shared/PaginationControls";
import styles from "./AttributeTable.module.css";

interface AttributeTableProps {
  records: Array<Record<string, unknown>>;
  attributes: string[];
}

const DEFAULT_PAGE_SIZE_OPTIONS = [15, 50, 100, 250];

export const AttributeTable: React.FC<AttributeTableProps> = ({
  records,
  attributes,
}) => {
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(15);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const filteredRecords = searchQuery.trim()
    ? records.filter((rec) =>
        attributes.some((attr) => {
          const val = rec[attr];
          return val !== undefined && val !== null && String(val).toLowerCase().includes(searchQuery.toLowerCase().trim());
        })
      )
    : records;

  const totalFilteredCount = filteredRecords.length;
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalFilteredCount);
  const paginatedRows = filteredRecords.slice(startIndex, endIndex);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
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
          <span>Tabla de Atributos ({totalFilteredCount.toLocaleString("es-UY")})</span>
        </h4>

        <div className={styles.searchBox}>
          <Search size={15} color="#94a3b8" />
          <input
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
                {attributes.map((attr) => (
                  <th key={attr}>{attr}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginatedRows.map((row, rowIdx) => {
                const globalIndex = startIndex + rowIdx + 1;
                return (
                  <tr key={rowIdx}>
                    <td key={`#-${rowIdx}`}>{globalIndex}</td>
                    {attributes.map((attr) => {
                      const val = row[attr];
                      const isNull = val === null || val === undefined || String(val).trim() === "";
                      return (
                        <td key={attr} title={!isNull ? String(val) : undefined}>
                          {isNull ? <span className={styles.nullVal}>null</span> : String(val)}
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
