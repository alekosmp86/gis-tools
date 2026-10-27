"use client";

import React from "react";
import { CLEAR_MODE, type ClearMode } from "../../jobs/cargar-padrones/constants";
import styles from "./WizardSteps.module.css";

const CLEAR_MODES: ReadonlyArray<{ mode: ClearMode; label: string }> = [
  { mode: CLEAR_MODE.DELETE, label: "DELETE" },
  { mode: CLEAR_MODE.TRUNCATE, label: "TRUNCATE" },
];

export interface ClearModeFieldsetProps {
  legend: string;
  value: ClearMode;
  descriptions: Record<ClearMode, string>;
  onChange: (mode: ClearMode) => void;
}

export const ClearModeFieldset: React.FC<ClearModeFieldsetProps> = ({ legend, value, descriptions, onChange }) => (
  <fieldset className={styles.group}>
    <legend>{legend}</legend>
    {CLEAR_MODES.map(({ mode, label }) => (
      <label key={mode} className={styles.checkRow}>
        <input type="radio" name="clearMode" value={mode} checked={value === mode} onChange={() => onChange(mode)} />
        <span>
          <strong>{label}</strong>. {descriptions[mode]}
        </span>
      </label>
    ))}
  </fieldset>
);
