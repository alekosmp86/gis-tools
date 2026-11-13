import React from "react";
import type { EjesListKey } from "./ejesCallesListMeta";
import { EJES_LIST_INTROS, ejesListAnchorOf } from "./ejesCallesListMeta";
import styles from "./EjesReport.module.css";

export interface EjesListSectionProps {
  listKey: EjesListKey;
  summary: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: React.ReactNode;
}

export const EjesListSection: React.FC<EjesListSectionProps> = ({ listKey, summary, open, onToggle, children }) => (
  <details
    id={ejesListAnchorOf(listKey)}
    className={styles.listSection}
    open={open}
    onToggle={(event) => onToggle(event.currentTarget.open)}
  >
    <summary className={styles.listSummary}>
      <span className={styles.listTitle}>{summary}</span>
      <span className={styles.listIntro}>{EJES_LIST_INTROS[listKey]}</span>
    </summary>
    <div className={styles.listBody}>{children}</div>
  </details>
);
