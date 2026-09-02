import React, { useState } from "react";
import { Layers, AlertTriangle } from "lucide-react";
import { SearchInput } from "@/components/ui/SearchInput";
import { PaginationControls } from "@/components/shared/PaginationControls";
import { ComparisonIcon } from "@/components/ui/ComparisonIcon";
import { DiscrepancyTypeBadge } from "./DiscrepancyTypeBadge";
import { DiscrepancySuidCell } from "./DiscrepancySuidCell";
import {
  DiscrepancyFilter,
  type DiscrepancyItem,
  type ComparisonSourceDescriptor,
} from "@/types/comparison";
import { formatNumber } from "@/utils/common/ValueFormatter";
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
      {/* Table Header Row with Title & Integrated Search */}
      <div className={styles.tableHeaderRow}>
        <div className={styles.titleGroup}>
          <div className={styles.headerIcon}>
            <Layers size={18} />
          </div>
          <div>
            <div className={styles.tableTitle}>Resultados de Evaluación de Discrepancias</div>
            <div className={styles.tableSubtitle}>
              Mostrando <span className={styles.countCyan}>{formatNumber(totalFilteredCount)}</span> de{" "}
              <span className={styles.countMuted}>{formatNumber(items.length)}</span> registros totales
            </div>
          </div>
        </div>

        <div className={styles.headerActions}>
          <div className={styles.searchWrapper}>
            <SearchInput
              value={searchQuery}
              onChange={onSearchChange}
              placeholder="Filtrar por SUID o atributo..."
            />
          </div>
        </div>
      </div>

      {/* Top Pagination Bar */}
      <PaginationControls {...paginationProps} />

      {/* Data Table */}
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thSuid}>SUID (Identificador)</th>
              <th className={styles.thStatus}>Tipo de Discrepancia</th>
              <th className={styles.thField}>Campo / Atributo</th>
              <th className={styles.thDb}>
                <span className={styles.thWithIcon}>
                  <ComparisonIcon kind={descriptor.targetIconKind} size={13} />
                  Valor {descriptor.targetLabel}
                </span>
              </th>
              <th className={styles.thShp}>
                <span className={styles.thWithIcon}>
                  <ComparisonIcon kind={descriptor.sourceIconKind} size={13} />
                  Valor {descriptor.sourceLabel}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {paginatedItems.length === 0 ? (
              <tr>
                <td colSpan={5} className={styles.emptyRow}>
                  <div className={styles.emptyContent}>
                    <AlertTriangle size={26} className={styles.emptyIcon} />
                    <div className={styles.emptyTitle}>No se encontraron registros</div>
                    <div className={styles.emptySubtitle}>
                      No hay discrepancias que coincidan con los filtros aplicados o el término de búsqueda.
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedItems.flatMap((item) => {
                if (item.differences.length === 0) {
                  return [
                    <tr key={item.id} className={styles.tableRow}>
                      <DiscrepancySuidCell item={item} descriptor={descriptor} />
                      <td className={styles.statusCell}>
                        <DiscrepancyTypeBadge type={item.type} descriptor={descriptor} />
                      </td>
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
                    <tr key={`${item.id}-${diff.fieldName}-${diffIndex}`} className={styles.tableRow}>
                      {diffIndex === 0 && (
                        <DiscrepancySuidCell
                          item={item}
                          descriptor={descriptor}
                          rowSpan={item.differences.length}
                        />
                      )}
                      {diffIndex === 0 && (
                        <td rowSpan={item.differences.length} className={styles.statusCell}>
                          <DiscrepancyTypeBadge type={item.type} descriptor={descriptor} />
                        </td>
                      )}
                      <td className={styles.fieldNameCell} title={diff.fieldName}>
                        <span className={styles.fieldNameBadge}>{diff.fieldName}</span>
                      </td>
                      <td className={styles.dbValueCell} title={dbValStr}>
                        <span className={styles.dbValChip}>{dbValStr}</span>
                      </td>
                      <td className={styles.shpValueCell} title={shpValStr}>
                        <span className={styles.shpValChip}>{shpValStr}</span>
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
