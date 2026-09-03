import React from "react";
import type { ComparisonSourceDescriptor } from "@/types/comparison";
import { ComparisonIcon } from "@/components/ui/ComparisonIcon";
import styles from "./DiscrepanciesTable.module.css";

export interface DiscrepanciesTableHeadProps {
  descriptor: ComparisonSourceDescriptor;
}

export const DiscrepanciesTableHead: React.FC<DiscrepanciesTableHeadProps> = ({
  descriptor,
}) => {
  return (
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
  );
};
