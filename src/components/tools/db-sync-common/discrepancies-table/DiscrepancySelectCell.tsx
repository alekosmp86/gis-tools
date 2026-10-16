import React from "react";
import type { DiscrepancyItem } from "@/core/types/comparison";
import { isSelectableItem } from "@/core/workers/comparison/DiscrepancySelection";
import styles from "./DiscrepancySelectCell.module.css";

const UNKEYED_SELECTION_BLOCKED_TITLE =
  "Sin clave primaria: no se puede actualizar de forma segura";

export interface DiscrepancySelectCellProps {
  item: DiscrepancyItem;
  rowSpan: number;
  checked: boolean;
  blocked: boolean;
  onToggle: (id: string) => void;
}

export const DiscrepancySelectCell: React.FC<DiscrepancySelectCellProps> = ({
  item,
  rowSpan,
  checked,
  blocked,
  onToggle,
}) => {
  if (!isSelectableItem(item)) {
    return <td rowSpan={rowSpan} className={styles.selectCell} />;
  }

  return (
    <td rowSpan={rowSpan} className={styles.selectCell}>
      <input
        type="checkbox"
        className={styles.checkbox}
        checked={checked && !blocked}
        disabled={blocked}
        title={blocked ? UNKEYED_SELECTION_BLOCKED_TITLE : undefined}
        aria-label={`Seleccionar registro ${item.suid}`}
        onChange={() => onToggle(item.id)}
      />
    </td>
  );
};
