import React from "react";
import styles from "../SpatialMapPreview.module.css";

export interface MapProgressBarProps {
  progressPct: number;
}

export const MapProgressBar: React.FC<MapProgressBarProps> = ({ progressPct }) => {
  return (
    <div className={styles.progressBarTrack}>
      <div
        className={styles.progressBarFill}
        ref={(element) => {
          if (element) {
            element.style.width = `${progressPct}%`;
          }
        }}
      />
    </div>
  );
};
