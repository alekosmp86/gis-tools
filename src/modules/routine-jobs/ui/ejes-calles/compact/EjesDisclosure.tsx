import React from "react";
import styles from "./EjesCompact.module.css";

export interface EjesDisclosureProps {
  summary: string;
  title?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}

/** A small expander inside a table cell: the summary stays visible, the body opens on demand. */
export const EjesDisclosure: React.FC<EjesDisclosureProps> = ({ summary, title, ariaLabel, children }) => (
  <details className={styles.disclosure}>
    <summary className={styles.summary} title={title} aria-label={ariaLabel}>
      {summary}
    </summary>
    <div className={styles.disclosureBody}>{children}</div>
  </details>
);
