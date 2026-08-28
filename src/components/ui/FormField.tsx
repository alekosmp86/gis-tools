import React, { useId } from "react";
import styles from "./FormField.module.css";

export interface FormFieldProps {
  id?: string;
  label: string;
  icon?: React.ElementType;
  type?: "text" | "password" | "number" | "email";
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  isFullWidth?: boolean;
  className?: string;
}

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
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
};
