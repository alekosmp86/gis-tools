"use client";

import React from "react";
import styles from "./DedupOptionsPanel.module.css";

interface DedupOptionsPanelProps {
  protectedSiblingRemovesLone: boolean;
  includeGroupsWithoutRemovals: boolean;
  onProtectedSiblingChange: (value: boolean) => void;
  onIncludeGroupsChange: (value: boolean) => void;
}

export const DedupOptionsPanel: React.FC<DedupOptionsPanelProps> = ({
  protectedSiblingRemovesLone,
  includeGroupsWithoutRemovals,
  onProtectedSiblingChange,
  onIncludeGroupsChange,
}) => (
  <div className={styles.panel}>
    <label className={styles.option}>
      <input
        type="checkbox"
        checked={protectedSiblingRemovesLone}
        onChange={(event) => onProtectedSiblingChange(event.target.checked)}
      />
      <span>Eliminar ANTEL/TLK duplicado de una fuente protegida (IDE)</span>
    </label>
    <label className={styles.option}>
      <input
        type="checkbox"
        checked={includeGroupsWithoutRemovals}
        onChange={(event) => onIncludeGroupsChange(event.target.checked)}
      />
      <span>Incluir grupos sin eliminaciones (para revisión)</span>
    </label>
  </div>
);
