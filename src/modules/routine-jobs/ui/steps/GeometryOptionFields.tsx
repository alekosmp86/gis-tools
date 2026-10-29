"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { FormField } from "@/ui-kit/components/ui/FormField";
import { AlertType } from "@/ui-kit/types/ui";
import type { GeometryOptionsDraft } from "../geometryOptions";
import styles from "./WizardSteps.module.css";

const TOLERANCE_LABEL = "Tolerancia (m)";
const TOLERANCE_HINT =
  "Distancia de Hausdorff en metros por debajo de la cual una geometría se considera sin cambios. Predeterminado: 1,0 m.";
const UPDATE_LABEL = "Actualizar geometrías";

export interface GeometryOptionFieldsProps {
  options: GeometryOptionsDraft;
  onChange: (patch: Partial<GeometryOptionsDraft>) => void;
  updateHint: string;
  overwriteWarning: string;
}

export const GeometryOptionFields: React.FC<GeometryOptionFieldsProps> = ({ options, onChange, updateHint, overwriteWarning }) => (
  <>
    <FormField label={TOLERANCE_LABEL} type="number" value={options.tolerance} onChange={(tolerance) => onChange({ tolerance })} />
    <p className={styles.hint}>{TOLERANCE_HINT}</p>

    <label className={styles.checkRow}>
      <input
        type="checkbox"
        checked={options.updateGeometries}
        onChange={(event) => onChange({ updateGeometries: event.target.checked })}
      />
      <span>{UPDATE_LABEL}</span>
    </label>
    <p className={styles.hint}>{updateHint}</p>
    {options.updateGeometries && <AlertMessage type={AlertType.WARNING} text={overwriteWarning} />}
  </>
);
