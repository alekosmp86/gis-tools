import React from "react";
import { EjesDisclosure } from "./EjesDisclosure";
import styles from "./EjesCompact.module.css";

export interface EjesRefsCellProps {
  label: string;
  refs: string[];
}

/** A count badge ("4 tramos nuevos") that opens the refs behind it; the refs also show on hover. */
export const EjesRefsCell: React.FC<EjesRefsCellProps> = ({ label, refs }) => (
  <EjesDisclosure summary={label} title={refs.join(", ")}>
    <p className={styles.refList}>{refs.join(", ")}</p>
  </EjesDisclosure>
);
