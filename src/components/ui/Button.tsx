import React from "react";
import type { ButtonProps } from "@/types/ui";
import styles from "./Button.module.css";

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = "primary",
  isDisabled = false,
  className = "",
  ...props
}) => {
  const variantClass =
    variant === "primary"
      ? styles.primary
      : variant === "secondary"
      ? styles.secondary
      : styles.ghost;

  return (
    <button
      className={`${styles.button} ${variantClass} ${isDisabled ? styles.disabled : ""} ${className}`}
      disabled={isDisabled}
      {...props}
    >
      {children}
    </button>
  );
};
