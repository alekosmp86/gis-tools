import React from "react";
import type { EjesListKey, EjesStripItem } from "./ejesCallesListMeta";
import styles from "./EjesReport.module.css";

export interface EjesSummaryStripProps {
  items: EjesStripItem[];
  openLists: ReadonlySet<EjesListKey>;
  onSelect: (list: EjesListKey) => void;
}

function StripBody({ item }: { item: EjesStripItem }) {
  return (
    <>
      <strong className={styles.stripValue}>{item.value}</strong>
      <span className={styles.stripLabel}>{item.label}</span>
    </>
  );
}

export const EjesSummaryStrip: React.FC<EjesSummaryStripProps> = ({ items, openLists, onSelect }) => (
  <div className={styles.strip}>
    {items.map((item) => {
      const list = item.list;
      if (list === null) {
        return (
          <div key={item.key} className={styles.stripItem}>
            <StripBody item={item} />
          </div>
        );
      }
      const active = openLists.has(list);
      return (
        <button
          key={item.key}
          type="button"
          className={active ? `${styles.stripItem} ${styles.stripItemActive}` : styles.stripItem}
          disabled={item.disabled ?? item.value === 0}
          aria-expanded={active}
          onClick={() => onSelect(list)}
        >
          <StripBody item={item} />
        </button>
      );
    })}
  </div>
);
