import React, { useId } from "react";
import type { FormFieldProps } from "@/types/ui";
import styles from "./FormField.module.css";

export const FormField: React.FC<FormFieldProps> = ({
  id,
  label,
  icon: Icon,
  type = "text",
  value,
  onChange,
  placeholder = "",
  isFullWidth = false,
  className = "",
}) => {
  const generatedId = useId();
  const inputId = id || generatedId;

  return (
    <div className={`${styles.inputGroup} ${isFullWidth ? styles.fullWidth : ""} ${className}`}>
      <label htmlFor={inputId}>
        {Icon && <Icon size={14} />}
        <span>{label}</span>
      </label>
      <input
        id={inputId}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
};
