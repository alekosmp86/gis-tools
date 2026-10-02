"use client";

import React, { useId } from "react";
import type { SelectOption } from "../types";
import styles from "./DedupFilterSelect.module.css";

interface DedupFilterSelectProps<TValue extends string> {
  label: string;
  value: TValue;
  options: ReadonlyArray<SelectOption<TValue>>;
  onChange: (value: TValue) => void;
}

export function DedupFilterSelect<TValue extends string>({
  label,
  value,
  options,
  onChange,
}: DedupFilterSelectProps<TValue>) {
  const selectId = useId();

  return (
    <div className={styles.field}>
      <label htmlFor={selectId} className={styles.label}>
        {label}
      </label>
      <select
        id={selectId}
        className={styles.select}
        value={value}
        onChange={(event) => onChange(event.target.value as TValue)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
