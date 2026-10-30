"use client";

import React from "react";
import styles from "./WizardSteps.module.css";

export interface AddressMasterLinkToggleProps {
  checked: boolean;
  label: string;
  hint: string;
  onChange: (checked: boolean) => void;
}

export const AddressMasterLinkToggle: React.FC<AddressMasterLinkToggleProps> = ({ checked, label, hint, onChange }) => (
  <>
    <label className={styles.checkRow}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
    <p className={styles.hint}>{hint}</p>
  </>
);
