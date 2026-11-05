"use client";

import React from "react";
import styles from "./WizardSteps.module.css";

export const SEQUENCE_REPAIR_LABEL = "Ajustar secuencias de destino";
const SEQUENCE_REPAIR_HINT =
  "Requiere el privilegio UPDATE sobre las secuencias de ids. Puede dejarse desactivada cuando la secuencia ya está por encima de los ids de la tabla: en ese caso basta USAGE.";

export interface SequenceRepairFieldProps {
  checked: boolean;
  onChange: (repairSequences: boolean) => void;
}

export const SequenceRepairField: React.FC<SequenceRepairFieldProps> = ({ checked, onChange }) => (
  <>
    <label className={styles.checkRow}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{SEQUENCE_REPAIR_LABEL}</span>
    </label>
    <p className={styles.hint}>{SEQUENCE_REPAIR_HINT}</p>
  </>
);
