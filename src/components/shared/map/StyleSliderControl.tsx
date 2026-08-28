import React from "react";
import styles from "./StyleSliderControl.module.css";

export interface StyleSliderControlProps {
  label: string;
  valueDisplay: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  ariaLabel: string;
}

export const StyleSliderControl: React.FC<StyleSliderControlProps> = ({
  label,
  valueDisplay,
  min,
  max,
  step,
  value,
  onChange,
  ariaLabel,
}) => {
  return (
    <div className={styles.controlSection}>
      <div className={styles.labelRow}>
        <span className={styles.sectionLabel}>{label}</span>
        <span className={styles.valueBadge}>{valueDisplay}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        className={styles.slider}
        aria-label={ariaLabel}
      />
    </div>
  );
};
