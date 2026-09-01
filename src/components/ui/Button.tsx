import React from "react";
import { ButtonVariant } from "@/types/ui";
import styles from "./Button.module.css";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: ButtonVariant;
  isDisabled?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = ButtonVariant.PRIMARY,
  isDisabled = false,
  disabled,
  className = "",
  ...props
}) => {
  const isEffectiveDisabled = Boolean(isDisabled || disabled);

  const variantClass =
    variant === ButtonVariant.PRIMARY
      ? styles.primary
      : variant === ButtonVariant.SECONDARY
      ? styles.secondary
      : styles.ghost;

  return (
    <button
      className={`${styles.button} ${variantClass} ${isEffectiveDisabled ? styles.disabled : ""} ${className}`}
      disabled={isEffectiveDisabled}
      {...props}
      suppressHydrationWarning
    >
      {children}
    </button>
  );
};
