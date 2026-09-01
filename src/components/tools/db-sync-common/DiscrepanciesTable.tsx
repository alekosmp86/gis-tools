import React, { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { PaginationControls } from "@/components/shared/PaginationControls";
import { DiscrepancyType, DiscrepancyFilter, type DiscrepancyItem } from "@/types/comparison";
import { BadgeVariant } from "@/types/ui";
import { formatNumber } from "@/utils/formatters";
import styles from "./DiscrepanciesTable.module.css";

export interface DiscrepanciesTableProps {
  items: DiscrepancyItem[];
  activeFilter: DiscrepancyFilter;
  searchQuery: string;
}

export const DiscrepanciesTable: React.FC<DiscrepanciesTableProps> = ({
  items,
  activeFilter,
  searchQuery,
}) => {
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [prevProps, setPrevProps] = useState({ activeFilter, searchQuery });

  if (prevProps.activeFilter !== activeFilter || prevProps.searchQuery !== searchQuery) {
    setPrevProps({ activeFilter, searchQuery });
    setCurrentPage(1);
  }

  const query = searchQuery.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    const matchesFilter =
      activeFilter === DiscrepancyFilter.ALL || item.type === activeFilter;
    if (!matchesFilter) return false;

    if (query === "") return true;

    const matchesSuid = item.suid.toLowerCase().includes(query);
    if (matchesSuid) return true;

    const matchesNote = item.note ? item.note.toLowerCase().includes(query) : false;
    if (matchesNote) return true;

    return item.differences.some(
      (diffItem) =>
        diffItem.fieldName.toLowerCase().includes(query) ||
        (diffItem.dbValue !== null && String(diffItem.dbValue).toLowerCase().includes(query)) ||
        (diffItem.shpValue !== null && String(diffItem.shpValue).toLowerCase().includes(query))
    );
  });

  const totalFilteredCount = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / pageSize));
  const validCurrentPage = Math.min(currentPage, totalPages);

  const startIndex = (validCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalFilteredCount);
  const paginatedItems = filteredItems.slice(startIndex, endIndex);

  const renderTypeBadge = (type: DiscrepancyType) => {
    switch (type) {
      case DiscrepancyType.MATCH:
        return <Badge variant={BadgeVariant.ACTIVE}>Coincidencia Exacta</Badge>;
      case DiscrepancyType.GEOMETRY_MISMATCH:
        return <span className={styles.badgeGeom}>Discrepancia Geométrica</span>;
      case DiscrepancyType.ATTRIBUTE_MISMATCH:
        return <Badge variant={BadgeVariant.DEV}>Discrepancia Atributos</Badge>;
      case DiscrepancyType.NULL_SUID:
        return <span className={styles.badgeNull}>SUID Nulo / Vacío</span>;
      case DiscrepancyType.DUPLICATE_SUID:
        return <span className={styles.badgeDuplicate}>SUID Duplicado</span>;
      case DiscrepancyType.ONLY_IN_DB:
        return <span className={styles.badgeDb}>Solo en DB</span>;
      case DiscrepancyType.ONLY_IN_SHP:
        return <span className={styles.badgeShp}>Solo en Archivo</span>;
      default:
        return null;
    }
  };

  const paginationProps = {
    currentPage: validCurrentPage,
    totalPages,
    pageSize,
    totalFilteredCount,
    startIndex,
    endIndex,
    onPageChange: setCurrentPage,
    onPageSizeChange: (newSize: number) => {
      setPageSize(newSize);
      setCurrentPage(1);
    },
  };

  return (
    <div className={styles.tableContainer}>
      <div className={styles.tableHeaderRow}>
        <span className={styles.tableTitle}>
          Resultados de Discrepancias ({formatNumber(totalFilteredCount)} de{" "}
          {formatNumber(items.length)} registros)
        </span>
      </div>

      {/* Top Pagination Bar */}
      <PaginationControls {...paginationProps} />

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>SUID (Identificador)</th>
              <th>Estado de Coincidencia</th>
              <th>Campo / Atributo</th>
              <th>Valor Base de Datos (PostGIS)</th>
              <th>Valor Archivo Fuente</th>
            </tr>
          </thead>
          <tbody>
            {paginatedItems.length === 0 ? (
              <tr>
                <td colSpan={5} className={styles.emptyRow}>
                  No se encontraron registros que coincidan con los filtros aplicados.
                </td>
              </tr>
            ) : (
              paginatedItems.flatMap((item) => {
                if (item.differences.length === 0) {
                  return [
                    <tr key={item.id}>
                      <td className={styles.suidCell} title={item.suid}>
                        {item.suid}
                        {item.note && <div className={styles.noteText}>{item.note}</div>}
                      </td>
                      <td>{renderTypeBadge(item.type)}</td>
                      <td className={styles.dimText}>--</td>
                      <td className={styles.dimText}>--</td>
                      <td className={styles.dimText}>--</td>
                    </tr>,
                  ];
                }

                return item.differences.map((diff, diffIndex) => {
                  const dbValStr =
                    diff.dbValue !== null && diff.dbValue !== undefined
                      ? String(diff.dbValue)
                      : "(Vacío / NULL)";
                  const shpValStr =
                    diff.shpValue !== null && diff.shpValue !== undefined
                      ? String(diff.shpValue)
                      : "(Vacío / NULL)";

                  return (
                    <tr key={`${item.id}-${diff.fieldName}-${diffIndex}`}>
                      {diffIndex === 0 && (
                        <td
                          rowSpan={item.differences.length}
                          className={styles.suidCell}
                          title={item.suid}
                        >
                          {item.suid}
                          {item.note && <div className={styles.noteText}>{item.note}</div>}
                        </td>
                      )}
                      {diffIndex === 0 && (
                        <td rowSpan={item.differences.length}>
                          {renderTypeBadge(item.type)}
                        </td>
                      )}
                      <td className={styles.fieldNameCell} title={diff.fieldName}>
                        {diff.fieldName}
                      </td>
                      <td className={styles.dbValueCell} title={dbValStr}>
                        {dbValStr}
                      </td>
                      <td className={styles.shpValueCell} title={shpValStr}>
                        {shpValStr}
                      </td>
                    </tr>
                  );
                });
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Bottom Pagination Bar */}
      <PaginationControls {...paginationProps} />
    </div>
  );
};
