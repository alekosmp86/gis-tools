import React from "react";
import type { DiscrepancyItem, ComparisonSourceDescriptor } from "@/types/comparison";
import { DiscrepancyFilter, DiscrepancyType } from "@/types/comparison";
import { DiscrepancySuidCell } from "../DiscrepancySuidCell";
import { DiscrepancyTypeBadge } from "../DiscrepancyTypeBadge";
import styles from "./DiscrepanciesTable.module.css";

export interface DiscrepancyItemRowsProps {
  item: DiscrepancyItem;
  descriptor: ComparisonSourceDescriptor;
  activeFilter: DiscrepancyFilter;
}

interface TableDiffRow {
  fieldName: string;
  dbValue: string;
  shpValue: string;
  isGeometry?: boolean;
  isEmptyPlaceholder?: boolean;
}

export const DiscrepancyItemRows: React.FC<DiscrepancyItemRowsProps> = ({
  item,
  descriptor,
  activeFilter,
}) => {
  const diffRows: TableDiffRow[] = [];

  const isGeometryCard = activeFilter === DiscrepancyFilter.GEOMETRY_MISMATCH;
  const isAttributeCard = activeFilter === DiscrepancyFilter.ATTRIBUTE_MISMATCH;

  const shouldIncludeGeometry =
    !isAttributeCard &&
    Boolean(item.geometryDifference || item.type === DiscrepancyType.GEOMETRY_MISMATCH);

  const shouldIncludeAttributes = !isGeometryCard && item.differences.length > 0;

  if (shouldIncludeGeometry) {
    const geomObj = item.shpGeometry as { type?: string } | undefined;
    diffRows.push({
      fieldName: "Geometría (geom)",
      dbValue: item.geometryDifference?.details || "Divergencia espacial",
      shpValue: geomObj?.type || "--",
      isGeometry: true,
    });
  }

  if (shouldIncludeAttributes) {
    item.differences.forEach((diff) => {
      diffRows.push({
        fieldName: diff.fieldName,
        dbValue:
          diff.dbValue !== null && diff.dbValue !== undefined
            ? String(diff.dbValue)
            : "(Vacío / NULL)",
        shpValue:
          diff.shpValue !== null && diff.shpValue !== undefined
            ? String(diff.shpValue)
            : "(Vacío / NULL)",
      });
    });
  }

  if (diffRows.length === 0) {
    diffRows.push({
      fieldName: "--",
      dbValue: "--",
      shpValue: "--",
      isEmptyPlaceholder: true,
    });
  }

  const totalRows = diffRows.length;
  const displayBadgeType = isGeometryCard
    ? DiscrepancyType.GEOMETRY_MISMATCH
    : isAttributeCard
    ? DiscrepancyType.ATTRIBUTE_MISMATCH
    : item.type;

  return (
    <>
      {diffRows.map((row, rowIndex) => (
        <tr key={`${item.id}-${row.fieldName}-${rowIndex}`} className={styles.tableRow}>
          {rowIndex === 0 && (
            <DiscrepancySuidCell
              item={item}
              descriptor={descriptor}
              rowSpan={totalRows}
            />
          )}
          {rowIndex === 0 && (
            <td rowSpan={totalRows} className={styles.statusCell}>
              <DiscrepancyTypeBadge type={displayBadgeType} descriptor={descriptor} />
            </td>
          )}
          <td
            className={row.isEmptyPlaceholder ? styles.dimText : styles.fieldNameCell}
            title={row.fieldName}
          >
            {row.isGeometry || row.isEmptyPlaceholder ? (
              row.fieldName
            ) : (
              <span className={styles.fieldNameBadge}>{row.fieldName}</span>
            )}
          </td>
          <td
            className={row.isEmptyPlaceholder ? styles.dimText : styles.dbValueCell}
            title={row.dbValue}
          >
            {row.isGeometry || row.isEmptyPlaceholder ? (
              row.dbValue
            ) : (
              <span className={styles.dbValChip}>{row.dbValue}</span>
            )}
          </td>
          <td
            className={row.isEmptyPlaceholder ? styles.dimText : styles.shpValueCell}
            title={row.shpValue}
          >
            {row.isGeometry || row.isEmptyPlaceholder ? (
              row.shpValue
            ) : (
              <span className={styles.shpValChip}>{row.shpValue}</span>
            )}
          </td>
        </tr>
      ))}
    </>
  );
};
