"use client";

import React from "react";
import type { CoverageSection, CoverageSectionId } from "./coverageSections";
import styles from "./CoverageSectionTabs.module.css";

interface CoverageSectionTabsProps {
  sections: ReadonlyArray<CoverageSection>;
  activeId: CoverageSectionId;
  onChange: (id: CoverageSectionId) => void;
}

function tabElementId(id: CoverageSectionId): string {
  return `coverage-tab-${id}`;
}

function panelElementId(id: CoverageSectionId): string {
  return `coverage-tabpanel-${id}`;
}

function resolveKeyTarget(key: string, currentIndex: number, lastIndex: number): number | null {
  if (key === "ArrowRight") return currentIndex === lastIndex ? 0 : currentIndex + 1;
  if (key === "ArrowLeft") return currentIndex === 0 ? lastIndex : currentIndex - 1;
  if (key === "Home") return 0;
  if (key === "End") return lastIndex;
  return null;
}

/** Accessible tablist with roving tabindex and arrow keys. Every panel stays mounted so a section keeps its progress while hidden. */
export const CoverageSectionTabs: React.FC<CoverageSectionTabsProps> = ({ sections, activeId, onChange }) => {
  const handleKeyDown = (event: React.KeyboardEvent, currentIndex: number) => {
    const targetIndex = resolveKeyTarget(event.key, currentIndex, sections.length - 1);
    if (targetIndex === null) return;

    event.preventDefault();
    const target = sections[targetIndex];
    onChange(target.id);
    document.getElementById(tabElementId(target.id))?.focus();
  };

  return (
    <div className={styles.tabs}>
      <div className={styles.tabList} role="tablist" aria-label="Secciones de cargas de coberturas">
        {sections.map((section, index) => {
          const isActive = section.id === activeId;
          return (
            <button
              key={section.id}
              id={tabElementId(section.id)}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={panelElementId(section.id)}
              tabIndex={isActive ? 0 : -1}
              className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
              onClick={() => onChange(section.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {section.label}
            </button>
          );
        })}
      </div>
      {sections.map(({ id, Component }) => (
        <div
          key={id}
          id={panelElementId(id)}
          role="tabpanel"
          aria-labelledby={tabElementId(id)}
          hidden={id !== activeId}
          className={styles.panel}
        >
          <Component />
        </div>
      ))}
    </div>
  );
};
