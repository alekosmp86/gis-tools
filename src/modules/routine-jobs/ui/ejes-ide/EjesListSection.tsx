import React from "react";
import type { EjesListKey } from "./ejesIdeListMeta";
import { EJES_LIST_INTROS, ejesListAnchorOf } from "./ejesIdeListMeta";
import styles from "./EjesReport.module.css";
import acceptStyles from "./EjesAccept.module.css";

export interface EjesListSectionProps {
  listKey: EjesListKey;
  summary: string;
  /** A count shown in the header next to the title, e.g. "2 aceptados de 5". */
  badge?: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: React.ReactNode;
}

export const EjesListSection: React.FC<EjesListSectionProps> = ({ listKey, summary, badge, open, onToggle, children }) => (
  <details
    id={ejesListAnchorOf(listKey)}
    className={styles.listSection}
    open={open}
    onToggle={(event) => onToggle(event.currentTarget.open)}
  >
    <summary className={styles.listSummary}>
      <span className={styles.listTitle}>{summary}</span>
      {badge !== undefined && <span className={acceptStyles.badge}>{badge}</span>}
      <span className={styles.listIntro}>{EJES_LIST_INTROS[listKey]}</span>
    </summary>
    <div className={styles.listBody}>{children}</div>
  </details>
);
