"use client";

import React from "react";
import { AlertTriangle, CheckCircle2, CloudDownload, RefreshCw } from "lucide-react";
import { SourceBadgeState } from "../types";
import styles from "./SourceStatusBadge.module.css";

interface SourceStatusBadgeProps {
  status: SourceBadgeState;
}

/** Presentation for each aggregate state, kept out of the component's control flow. */
const BADGE_PRESENTATION = {
  [SourceBadgeState.UP_TO_DATE]: {
    label: "Al día",
    className: "upToDate",
    Icon: CheckCircle2,
  },
  [SourceBadgeState.UPDATE_AVAILABLE]: {
    label: "Actualización disponible",
    className: "updateAvailable",
    Icon: RefreshCw,
  },
  [SourceBadgeState.NOT_DOWNLOADED]: {
    label: "Pendiente de descarga",
    className: "notDownloaded",
    Icon: CloudDownload,
  },
  [SourceBadgeState.ERROR]: {
    label: "Sin respuesta",
    className: "error",
    Icon: AlertTriangle,
  },
} as const;

export const SourceStatusBadge: React.FC<SourceStatusBadgeProps> = ({ status }) => {
  const { label, className, Icon } = BADGE_PRESENTATION[status];

  return (
    <span className={`${styles.badge} ${styles[className]}`}>
      <Icon size={13} />
      {label}
    </span>
  );
};
