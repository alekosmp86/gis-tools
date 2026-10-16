import React from "react";
import { CheckSquare, ListChecks, Square, XCircle } from "lucide-react";
import { formatNumber } from "@/core/common/ValueFormatter";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import styles from "./DiscrepanciesSelectionBar.module.css";

export interface DiscrepanciesSelectionBarProps {
  selectedCount: number;
  selectableCount: number;
  selectedInFilterCount: number;
  hasSelectableOnPage: boolean;
  hasSelectableInFilter: boolean;
  onSelectPage: () => void;
  onSelectFiltered: () => void;
  onDeselectPage: () => void;
  onClear: () => void;
}

export const DiscrepanciesSelectionBar: React.FC<DiscrepanciesSelectionBarProps> = ({
  selectedCount,
  selectableCount,
  selectedInFilterCount,
  hasSelectableOnPage,
  hasSelectableInFilter,
  onSelectPage,
  onSelectFiltered,
  onDeselectPage,
  onClear,
}) => {
  const showFilterBreakdown = selectedInFilterCount !== selectedCount;

  return (
    <div className={styles.bar}>
      <div className={styles.counter}>
        <span className={styles.counterValue}>{formatNumber(selectedCount)}</span> de{" "}
        <span className={styles.counterTotal}>{formatNumber(selectableCount)}</span> seleccionados
        {showFilterBreakdown && (
          <span className={styles.filterNote}>
            {" "}({formatNumber(selectedInFilterCount)} en el filtro actual)
          </span>
        )}
      </div>

      <div className={styles.actions}>
        <Button
          type="button"
          variant={ButtonVariant.SECONDARY}
          disabled={!hasSelectableOnPage}
          onClick={onSelectPage}
        >
          <CheckSquare size={15} />
          <span>Seleccionar página</span>
        </Button>
        <Button
          type="button"
          variant={ButtonVariant.SECONDARY}
          disabled={!hasSelectableInFilter}
          onClick={onSelectFiltered}
        >
          <ListChecks size={15} />
          <span>Seleccionar todos (filtro actual)</span>
        </Button>
        <Button
          type="button"
          variant={ButtonVariant.SECONDARY}
          disabled={!hasSelectableOnPage}
          onClick={onDeselectPage}
        >
          <Square size={15} />
          <span>Deseleccionar página</span>
        </Button>
        <Button
          type="button"
          variant={ButtonVariant.GHOST}
          disabled={selectedCount === 0}
          onClick={onClear}
        >
          <XCircle size={15} />
          <span>Limpiar selección</span>
        </Button>
      </div>
    </div>
  );
};
