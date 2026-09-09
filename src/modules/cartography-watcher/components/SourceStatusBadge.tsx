"use client";

import React from "react";
import {
  RefreshCw,
  Sparkles,
  CheckCircle,
  HardDrive,
  AlertCircle,
} from "lucide-react";
import {
  type SourceCheckSummary,
  SourceBadgeState,
} from "../types/watcher";
import styles from "./SourceSelector.module.css";

export interface SourceStatusBadgeProps {
  summary?: SourceCheckSummary;
  isChecking?: boolean;
}

export const SourceStatusBadge: React.FC<SourceStatusBadgeProps> = ({
  summary,
  isChecking = false,
}) => {
  if (!summary || isChecking) {
    return (
      <span className={styles.badgeChecking}>
        <RefreshCw size={12} className="animate-spin" />
        <span>Verificando</span>
      </span>
    );
  }

  if (summary.status === SourceBadgeState.UPDATE_AVAILABLE) {
    return (
      <span className={styles.badgeUpdate}>
        <Sparkles size={12} />
        <span>{summary.updatesCount} novedades</span>
      </span>
    );
  }

  if (summary.status === SourceBadgeState.UP_TO_DATE) {
    return (
      <span className={styles.badgeUpToDate}>
        <CheckCircle size={12} />
        <span>Al día</span>
      </span>
    );
  }

  if (summary.status === SourceBadgeState.NOT_DOWNLOADED) {
    return (
      <span className={styles.badgeNotDownloaded}>
        <HardDrive size={12} />
        <span>Sin descargar</span>
      </span>
    );
  }

  return (
    <span className={styles.badgeError}>
      <AlertCircle size={12} />
      <span>Error</span>
    </span>
  );
};

SourceStatusBadge.displayName = "SourceStatusBadge";
