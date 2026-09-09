"use client";

import React from "react";
import { formatDate } from "../utils/watcherFormatters";
import styles from "./WatcherHeroCard.module.css";

export interface WatcherStatsRowProps {
  totalResources: number;
  updatesCount: number;
  datasetModified?: string | null;
}

export const WatcherStatsRow: React.FC<WatcherStatsRowProps> = ({
  totalResources,
  updatesCount,
  datasetModified,
}) => {
  return (
    <div className={styles.statsRow}>
      <div className={styles.statBox}>
        <span className={styles.statLabel}>Total Recursos</span>
        <span className={styles.statValue}>{totalResources}</span>
      </div>
      <div className={styles.statBox}>
        <span className={styles.statLabel}>Actualizaciones Disponibles</span>
        <span
          className={`${styles.statValue} ${
            updatesCount > 0 ? styles.statValueHighlight : ""
          }`}
        >
          {updatesCount}
        </span>
      </div>
      <div className={styles.statBox}>
        <span className={styles.statLabel}>Última Modificación</span>
        <span className={styles.statValue}>{formatDate(datasetModified)}</span>
      </div>
    </div>
  );
};

WatcherStatsRow.displayName = "WatcherStatsRow";
