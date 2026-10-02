"use client";

import React from "react";
import { DedupTab } from "../constants";
import { TAB_LABELS } from "../data/dedupLabels";
import styles from "./DedupTabs.module.css";

interface DedupTabsProps {
  activeTab: DedupTab;
  groupCount: string;
  onChange: (tab: DedupTab) => void;
  children: React.ReactNode;
}

const TAB_ORDER: ReadonlyArray<DedupTab> = [DedupTab.SUMMARY, DedupTab.GROUPS];

const PANEL_ID = "dedup-tabpanel";

function tabElementId(tab: DedupTab): string {
  return `dedup-tab-${tab}`;
}

function resolveKeyTarget(key: string, currentIndex: number): number | null {
  const lastIndex = TAB_ORDER.length - 1;
  if (key === "ArrowRight") return currentIndex === lastIndex ? 0 : currentIndex + 1;
  if (key === "ArrowLeft") return currentIndex === 0 ? lastIndex : currentIndex - 1;
  if (key === "Home") return 0;
  if (key === "End") return lastIndex;
  return null;
}

/** Accessible tablist with roving tabindex and arrow-key navigation; renders one panel. */
export const DedupTabs: React.FC<DedupTabsProps> = ({ activeTab, groupCount, onChange, children }) => {
  const handleKeyDown = (event: React.KeyboardEvent, currentIndex: number) => {
    const targetIndex = resolveKeyTarget(event.key, currentIndex);
    if (targetIndex === null) return;

    event.preventDefault();
    const targetTab = TAB_ORDER[targetIndex];
    onChange(targetTab);
    document.getElementById(tabElementId(targetTab))?.focus();
  };

  return (
    <div className={styles.tabs}>
      <div className={styles.tabList} role="tablist" aria-label="Resultados del análisis">
        {TAB_ORDER.map((tab, index) => {
          const isActive = tab === activeTab;
          const label = tab === DedupTab.GROUPS ? `${TAB_LABELS[tab]} (${groupCount})` : TAB_LABELS[tab];
          return (
            <button
              key={tab}
              id={tabElementId(tab)}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={PANEL_ID}
              tabIndex={isActive ? 0 : -1}
              className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
              onClick={() => onChange(tab)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div id={PANEL_ID} role="tabpanel" aria-labelledby={tabElementId(activeTab)} tabIndex={0} className={styles.panel}>
        {children}
      </div>
    </div>
  );
};
