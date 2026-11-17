"use client";

import React from "react";
import type { SelectFieldOption } from "@/ui-kit/types/ui";
import styles from "./SelectField.module.css";

export interface SelectFieldProps<TValue extends string> {
  label: string;
  value: TValue;
  options: readonly SelectFieldOption<TValue>[];
  onChange: (value: TValue) => void;
}

/** A labelled native select drawn in the dark theme: the closed control and its open list share the app tokens. */
export function SelectField<TValue extends string>({ label, value, options, onChange }: SelectFieldProps<TValue>) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <select className={styles.select} value={value} onChange={(event) => onChange(event.currentTarget.value as TValue)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
