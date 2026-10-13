"use client";

import React from "react";
import { useModuleContributions } from "./ModuleContributionsContext";
import { ModuleSlot } from "./ModuleSlot";
import { UiSlot } from "./contracts";
import styles from "./AppStatusSlot.module.css";

/**
 * Hosts the app-wide status chips. Draws nothing when no module contributes to the slot, so the
 * application looks identical with zero modules registered.
 */
export const AppStatusSlot: React.FC = () => {
  const contributions = useModuleContributions();

  if (!contributions.some((contribution) => contribution.slot === UiSlot.APP_STATUS)) {
    return null;
  }

  return (
    <div className={styles.host}>
      <ModuleSlot slot={UiSlot.APP_STATUS} />
    </div>
  );
};
