import React, { useMemo } from "react";
import { Badge } from "@/components/ui/Badge";
import { DiscrepancyType, DiscrepancyFilter, type DiscrepanciesTableProps } from "@/types/comparison";
import { BadgeVariant } from "@/types/ui";
import styles from "./DiscrepanciesTable.module.css";

export const DiscrepanciesTable: React.FC<DiscrepanciesTableProps> = ({
  items,
  activeFilter,
  searchQuery,
}) => {
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesFilter =
        activeFilter === DiscrepancyFilter.ALL || item.type === activeFilter;
      const matchesSearch =
        searchQuery === "" ||
        item.suid.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.differences.some(
          (d) =>
            d.fieldName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            String(d.dbValue).toLowerCase().includes(searchQuery.toLowerCase()) ||
            String(d.shpValue).toLowerCase().includes(searchQuery.toLowerCase())
        );
      return matchesFilter && matchesSearch;
    });
  }, [items, activeFilter, searchQuery]);

  const renderTypeBadge = (type: DiscrepancyType) => {
    switch (type) {
      case DiscrepancyType.MATCH:
        return <Badge variant={BadgeVariant.ACTIVE}>Coincidencia Exacta</Badge>;
      case DiscrepancyType.ATTRIBUTE_MISMATCH:
        return <Badge variant={BadgeVariant.DEV}>Discrepancia Atributos</Badge>;
      case DiscrepancyType.ONLY_IN_DB:
        return <span className={styles.badgeDb}>Solo en DB</span>;
      case DiscrepancyType.ONLY_IN_SHP:
        return <span className={styles.badgeShp}>Solo en SHP</span>;
      default:
        return null;
    }
  };

  return (
    <div className={styles.tableContainer}>
      <div className={styles.tableHeaderRow}>
        <span className={styles.tableTitle}>
          Resultados de Discrepancias ({filteredItems.length} registros de {items.length})
        </span>
      </div>

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>SUID (Identificador)</th>
              <th>Estado de Coincidencia</th>
              <th>Campo / Atributo</th>
              <th>Valor Base de Datos (PostGIS)</th>
              <th>Valor Shapefile (DBF)</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={5} className={styles.emptyRow}>
                  No se encontraron registros que coincidan con los filtros aplicados.
                </td>
              </tr>
            ) : (
              filteredItems.flatMap((item) => {
                if (item.differences.length === 0) {
                  return [
                    <tr key={item.id}>
                      <td className={styles.suidCell}>{item.suid}</td>
                      <td>{renderTypeBadge(item.type)}</td>
                      <td className={styles.dimText}>--</td>
                      <td className={styles.dimText}>--</td>
                      <td className={styles.dimText}>--</td>
                    </tr>,
                  ];
                }

                return item.differences.map((diff, idx) => (
                  <tr key={`${item.id}-${diff.fieldName}-${idx}`}>
                    {idx === 0 && (
                      <td rowSpan={item.differences.length} className={styles.suidCell}>
                        {item.suid}
                      </td>
                    )}
                    {idx === 0 && (
                      <td rowSpan={item.differences.length}>
                        {renderTypeBadge(item.type)}
                      </td>
                    )}
                    <td className={styles.fieldNameCell}>{diff.fieldName}</td>
                    <td className={styles.dbValueCell}>
                      {diff.dbValue !== null && diff.dbValue !== undefined
                        ? String(diff.dbValue)
                        : "(Vacío / NULL)"}
                    </td>
                    <td className={styles.shpValueCell}>
                      {diff.shpValue !== null && diff.shpValue !== undefined
                        ? String(diff.shpValue)
                        : "(Vacío / NULL)"}
                    </td>
                  </tr>
                ));
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
