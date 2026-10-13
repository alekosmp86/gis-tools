"use client";

import React from "react";
import styles from "./IndicatorsShrinkConfirm.module.css";

interface IndicatorsShrinkConfirmProps {
  isChecked: boolean;
  isDisabled: boolean;
  onChange: (value: boolean) => void;
}

export const IndicatorsShrinkConfirm: React.FC<IndicatorsShrinkConfirmProps> = ({
  isChecked,
  isDisabled,
  onChange,
}) => (
  <label className={styles.option}>
    <input
      type="checkbox"
      checked={isChecked}
      disabled={isDisabled}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span>
      Acepto reemplazar un corte por uno con menos filas que las que existen hoy en el histórico.
    </span>
  </label>
);
