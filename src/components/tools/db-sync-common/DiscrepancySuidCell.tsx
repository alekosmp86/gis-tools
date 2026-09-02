import React from "react";
import type { DiscrepancyItem, ComparisonSourceDescriptor } from "@/types/comparison";
import styles from "./DiscrepancySuidCell.module.css";

export interface DiscrepancySuidCellProps {
  item: DiscrepancyItem;
  descriptor: ComparisonSourceDescriptor;
  rowSpan?: number;
}

export const DiscrepancySuidCell: React.FC<DiscrepancySuidCellProps> = ({
  item,
  descriptor,
  rowSpan,
}) => {
  return (
    <td rowSpan={rowSpan} className={styles.suidCell} title={item.suid}>
      <span className={styles.suidText}>{item.suid}</span>
      {item.duplicateDetails ? (
        <div className={styles.noteText}>
          SUID Duplicado ({item.duplicateDetails.targetCount} en {descriptor.targetShortLabel} / {item.duplicateDetails.sourceCount} en {descriptor.sourceShortLabel})
        </div>
      ) : item.note ? (
        <div className={styles.noteText}>{item.note}</div>
      ) : null}
    </td>
  );
};
