import React, { useState } from "react";
import { Layers, AlertTriangle, Database, FileSpreadsheet } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { SearchInput } from "@/components/ui/SearchInput";
import { PaginationControls } from "@/components/shared/PaginationControls";
import { DiscrepancyType, DiscrepancyFilter, type DiscrepancyItem } from "@/types/comparison";
import { BadgeVariant } from "@/types/ui";
import { formatNumber } from "@/utils/common/ValueFormatter";
import styles from "./DiscrepanciesTable.module.css";

export interface DiscrepanciesTableProps {
  items: DiscrepancyItem[];
  activeFilter: DiscrepancyFilter;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export const DiscrepanciesTable: React.FC<DiscrepanciesTableProps> = ({
  items,
  activeFilter,
  searchQuery,
  onSearchChange,
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
        return <span className={styles.badgeGeom}>Diferencia Geométrica</span>;
      case DiscrepancyType.ATTRIBUTE_MISMATCH:
        return <span className={styles.badgeAttr}>Diferencia de Atributos</span>;
      case DiscrepancyType.NULL_SUID:
        return <span className={styles.badgeNull}>SUID Nulo / Vacío</span>;
      case DiscrepancyType.DUPLICATE_SUID:
        return <span className={styles.badgeDuplicate}>SUID Duplicado</span>;
      case DiscrepancyType.ONLY_IN_DB:
        return <span className={styles.badgeDb}>Solo en Base de Datos</span>;
      case DiscrepancyType.ONLY_IN_SHP:
        return <span className={styles.badgeShp}>Solo en Archivo Fuente</span>;
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
                  <Database size={13} />
                  Valor Base de Datos
                </span>
              </th>
              <th className={styles.thShp}>
                <span className={styles.thWithIcon}>
                  <FileSpreadsheet size={13} />
                  Valor Archivo
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
                      <td className={styles.suidCell} title={item.suid}>
                        <span className={styles.suidText}>{item.suid}</span>
                        {item.note && <div className={styles.noteText}>{item.note}</div>}
                      </td>
                      <td className={styles.statusCell}>{renderTypeBadge(item.type)}</td>
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
                        <td
                          rowSpan={item.differences.length}
                          className={styles.suidCell}
                          title={item.suid}
                        >
                          <span className={styles.suidText}>{item.suid}</span>
                          {item.note && <div className={styles.noteText}>{item.note}</div>}
                        </td>
                      )}
                      {diffIndex === 0 && (
                        <td rowSpan={item.differences.length} className={styles.statusCell}>
                          {renderTypeBadge(item.type)}
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
