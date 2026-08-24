import React from "react";
import type { FormFieldProps } from "@/types/ui";
import styles from "./FormField.module.css";

export const FormField: React.FC<FormFieldProps> = ({
  label,
  icon: Icon,
  type = "text",
  value,
  onChange,
  placeholder = "",
  isFullWidth = false,
  className = "",
}) => {
  return (
    <div className={`${styles.inputGroup} ${isFullWidth ? styles.fullWidth : ""} ${className}`}>
      <label>
        {Icon && <Icon size={14} />}
        <span>{label}</span>
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
};
