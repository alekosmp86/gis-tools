import React from "react";
import { Download, CheckCircle2, AlertTriangle } from "lucide-react";
import { DeltaStatus } from "../types/watcher";
import styles from "./ResourceCard.module.css";

export interface ResourceStatusBadgeProps {
  status: DeltaStatus;
}

export const ResourceStatusBadge: React.FC<ResourceStatusBadgeProps> = ({ status }) => {
  if (status === DeltaStatus.UP_TO_DATE) {
    return (
      <span className={`${styles.statusBadge} ${styles.statusUpToDate}`}>
        <CheckCircle2 size={13} />
        Al día
      </span>
    );
  }

  if (status === DeltaStatus.UPDATE_AVAILABLE) {
    return (
      <span className={`${styles.statusBadge} ${styles.statusUpdateAvailable}`}>
        <AlertTriangle size={13} />
        Actualización disponible
      </span>
    );
  }

  return (
    <span className={`${styles.statusBadge} ${styles.statusNotDownloaded}`}>
      <Download size={13} />
      Pendiente de descarga
    </span>
  );
};
