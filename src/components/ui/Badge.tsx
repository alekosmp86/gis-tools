import React from "react";
import { BadgeVariant } from "@/types/ui";
import styles from "./Badge.module.css";

export interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = BadgeVariant.PLANNED,
  className = "",
}) => {
  const variantClass =
    variant === BadgeVariant.ACTIVE
      ? styles.active
      : variant === BadgeVariant.DEV
      ? styles.dev
      : styles.planned;

  return (
    <span className={`${styles.badge} ${variantClass} ${className}`}>
      {children}
    </span>
  );
};
