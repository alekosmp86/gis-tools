import React from "react";
import { BadgeVariant, type BadgeProps } from "@/types/ui";
import styles from "./Badge.module.css";

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
