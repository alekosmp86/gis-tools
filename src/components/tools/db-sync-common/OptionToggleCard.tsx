import React from "react";
import styles from "./OptionToggleCard.module.css";

export type OptionToggleTone = "sky" | "amber";

const TONE_CLASS: Record<OptionToggleTone, string> = {
  sky: styles.toneSky,
  amber: styles.toneAmber,
};

export interface OptionToggleCardProps {
  tone: OptionToggleTone;
  icon: React.ReactNode;
  title: string;
  isEnabled: boolean;
  isActive: boolean;
  activeBadge: React.ReactNode;
  inactiveBadge: React.ReactNode;
  toggleLabel: string;
  onToggleEnabled: (enabled: boolean) => void;
  description: React.ReactNode;
  children?: React.ReactNode;
}

export const OptionToggleCard: React.FC<OptionToggleCardProps> = ({
  tone,
  icon,
  title,
  isEnabled,
  isActive,
  activeBadge,
  inactiveBadge,
  toggleLabel,
  onToggleEnabled,
  description,
  children,
}) => {
  return (
    <div
      className={`${TONE_CLASS[tone]} ${styles.cardContainer} ${
        isActive ? styles.cardContainerActive : ""
      }`}
    >
      <div className={styles.headerRow}>
        <div className={styles.titleArea}>
          <div className={styles.iconWrapper}>{icon}</div>
          <h4 className={styles.titleText}>{title}</h4>
          {isActive ? (
            <span className={styles.activeBadge}>{activeBadge}</span>
          ) : (
            <span className={styles.inactiveBadge}>{inactiveBadge}</span>
          )}
        </div>

        <label className={styles.toggleLabel}>
          <input
            type="checkbox"
            className={styles.toggleInput}
            checked={isEnabled}
            onChange={(event) => onToggleEnabled(event.target.checked)}
          />
          <span
            className={`${styles.toggleTrack} ${
              isEnabled ? styles.toggleTrackActive : ""
            }`}
          >
            <span
              className={`${styles.toggleThumb} ${
                isEnabled ? styles.toggleThumbActive : ""
              }`}
            />
          </span>
          <span>{toggleLabel}</span>
        </label>
      </div>

      <p className={styles.descriptionText}>{description}</p>

      {children}
    </div>
  );
};

export const OptionToggleNotice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className={styles.noticeBox}>{children}</div>
);
