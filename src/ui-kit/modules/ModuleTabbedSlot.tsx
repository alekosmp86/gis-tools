"use client";

import React, { useState } from "react";
import { UploadCloud } from "lucide-react";
import { ModuleErrorBoundary } from "./ModuleErrorBoundary";
import { useModuleContributions } from "./ModuleContributionsContext";
import type { UiContribution, UiSlot } from "./contracts";
import styles from "./ModuleTabbedSlot.module.css";

/**
 * A slot that offers its contributions as alternatives to the host's own content.
 *
 * With nothing contributed it renders `children` alone, with no tab strip and no wrapper — the host
 * looks exactly as it did before the slot existed, which is the property that makes a module
 * removable. With contributions present it draws a tab per contribution beside the host's default
 * tab, and renders whichever is active.
 *
 * Each contribution is isolated: one that throws is dropped by the boundary and the host's own tab
 * keeps working.
 */

/** Identifies the host's own content, which is always the first tab and the initial selection. */
const HOST_TAB_ID = "host";

interface ModuleTabbedSlotProps {
  slot: UiSlot;
  /** Label for the host's own tab, e.g. "Subir desde PC". */
  defaultLabel: string;
  defaultIcon?: React.ComponentType<{ size?: number }>;
  children: React.ReactNode;
}

function sortContributions(
  contributions: ReadonlyArray<UiContribution>
): ReadonlyArray<UiContribution> {
  return [...contributions].sort(
    (first, second) =>
      (first.order ?? Number.MAX_SAFE_INTEGER) - (second.order ?? Number.MAX_SAFE_INTEGER)
  );
}

export const ModuleTabbedSlot: React.FC<ModuleTabbedSlotProps> = ({
  slot,
  defaultLabel,
  defaultIcon: DefaultIcon = UploadCloud,
  children,
}) => {
  const [activeTabId, setActiveTabId] = useState<string>(HOST_TAB_ID);
  const contributions = sortContributions(
    useModuleContributions().filter((contribution) => contribution.slot === slot)
  );

  if (contributions.length === 0) {
    return <>{children}</>;
  }

  const activeContribution = contributions.find(
    (contribution) => contribution.id === activeTabId
  );

  return (
    <div>
      <div className={styles.sourceTabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTabId === HOST_TAB_ID}
          className={`${styles.sourceTab} ${activeTabId === HOST_TAB_ID ? styles.sourceTabActive : ""}`}
          onClick={() => setActiveTabId(HOST_TAB_ID)}
        >
          <DefaultIcon size={16} />
          <span>{defaultLabel}</span>
        </button>

        {contributions.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTabId === id}
            className={`${styles.sourceTab} ${activeTabId === id ? styles.sourceTabActive : ""}`}
            onClick={() => setActiveTabId(id)}
          >
            {Icon && <Icon size={16} />}
            <span>{label ?? id}</span>
          </button>
        ))}
      </div>

      <div className={styles.panel}>
        {activeContribution ? (
          <ModuleErrorBoundary key={activeContribution.id} contributionId={activeContribution.id}>
            <activeContribution.Component />
          </ModuleErrorBoundary>
        ) : (
          children
        )}
      </div>
    </div>
  );
};
