import React from "react";
import type { LucideIcon } from "lucide-react";
import { formatNumber } from "@/utils/formatters";
import styles from "./DiscrepanciesSummaryBar.module.css";

export interface SummaryKpiCardProps {
  title: string;
  value: number;
  subtitle: React.ReactNode;
  icon: LucideIcon;
  iconContainerClass: string;
  valueClass?: string;
  isActive: boolean;
  onClick: () => void;
}

export const SummaryKpiCard: React.FC<SummaryKpiCardProps> = ({
  title,
  value,
  subtitle,
  icon: IconComponent,
  iconContainerClass,
  valueClass = "",
  isActive,
  onClick,
}) => {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={`${styles.kpiCard} ${isActive ? styles.active : ""}`}
    >
      <div className={styles.cardHeader}>
        <span className={styles.cardTitle}>{title}</span>
        <div className={iconContainerClass}>
          <IconComponent size={18} />
        </div>
      </div>
      <div className={`${styles.cardValue} ${valueClass}`}>{formatNumber(value)}</div>
      <div className={styles.cardSub}>{subtitle}</div>
    </div>
  );
};
