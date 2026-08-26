import React from "react";
import type { MapProgressBarProps } from "@/types/map";
import styles from "../SpatialMapPreview.module.css";

export const MapProgressBar: React.FC<MapProgressBarProps> = ({ progressPct }) => {
  return (
    <div className={styles.progressBarTrack}>
      <div className={styles.progressBarFill} style={{ width: `${progressPct}%` }} />
    </div>
  );
};
