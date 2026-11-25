import React from "react";
import { EjesDisclosure } from "./EjesDisclosure";
import type { EjesDetailFact } from "./ejesDetailFacts";
import { EJES_COMPACT_TEXT } from "./ejesCompactTexts";
import styles from "./EjesCompact.module.css";

export interface EjesDetailCellProps {
  ariaLabel: string;
  facts: EjesDetailFact[];
}

/** The technical numbers of a row, kept out of the main view behind a "Ver detalle" toggle. */
export const EjesDetailCell: React.FC<EjesDetailCellProps> = ({ ariaLabel, facts }) => (
  <EjesDisclosure summary={EJES_COMPACT_TEXT.SHOW_DETAIL} ariaLabel={ariaLabel}>
    <dl className={styles.facts}>
      {facts.map((fact) => (
        <React.Fragment key={fact.label}>
          <dt className={styles.factTerm}>{fact.label}</dt>
          <dd className={styles.factValue}>{fact.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  </EjesDisclosure>
);
