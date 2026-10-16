import React from "react";
import type { ComparisonSourceDescriptor } from "@/core/types/comparison";
import { SelectionCheckState } from "@/core/types/selection";
import { ComparisonIcon } from "@/ui-kit/components/ui/ComparisonIcon";
import selectStyles from "./DiscrepancySelectCell.module.css";
import styles from "./DiscrepanciesTable.module.css";

export interface DiscrepanciesTableHeadProps {
  descriptor: ComparisonSourceDescriptor;
  pageCheckState: SelectionCheckState;
  hasSelectableOnPage: boolean;
  onTogglePage: () => void;
}

export const DiscrepanciesTableHead: React.FC<DiscrepanciesTableHeadProps> = ({
  descriptor,
  pageCheckState,
  hasSelectableOnPage,
  onTogglePage,
}) => {
  return (
    <thead>
      <tr>
        <th className={styles.thSelect}>
          <input
            type="checkbox"
            className={selectStyles.checkbox}
            ref={(element) => {
              if (element) element.indeterminate = pageCheckState === SelectionCheckState.SOME;
            }}
            checked={pageCheckState === SelectionCheckState.ALL}
            disabled={!hasSelectableOnPage}
            aria-label="Seleccionar todos los registros de esta página"
            onChange={onTogglePage}
          />
        </th>
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
  );
};
