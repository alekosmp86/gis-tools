import React from "react";
import styles from "./Badge.module.css";

export interface BadgeProps {
  children: React.ReactNode;
  variant?: "active" | "dev" | "planned";
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = "planned",
  className = "",
}) => {
  const variantClass =
    variant === "active"
      ? styles.active
      : variant === "dev"
      ? styles.dev
      : styles.planned;

  return (
    <span className={`${styles.badge} ${variantClass} ${className}`}>
      {children}
    </span>
  );
};
