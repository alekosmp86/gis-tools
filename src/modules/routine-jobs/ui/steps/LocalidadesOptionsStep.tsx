"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { FormField } from "@/ui-kit/components/ui/FormField";
import { AlertType } from "@/ui-kit/types/ui";
import { GEOMETRY_OVERWRITE_WARNING, type LocalidadesOptionsDraft } from "../cargarLocalidadesWizardState";
import styles from "./WizardSteps.module.css";

const TOLERANCE_LABEL = "Tolerancia (m)";
const TOLERANCE_HINT =
  "Distancia de Hausdorff en metros por debajo de la cual una geometría se considera sin cambios. Predeterminado: 1,0 m.";
const UPDATE_LABEL = "Actualizar geometrías";
const UPDATE_HINT =
  "Si está activada, la geometría de las localidades que cambiaron se reemplaza en la carga real. Las inserciones se hacen igual.";

export interface LocalidadesOptionsStepProps {
  options: LocalidadesOptionsDraft;
  onChange: (patch: Partial<LocalidadesOptionsDraft>) => void;
  blockingReason: string | null;
}

export const LocalidadesOptionsStep: React.FC<LocalidadesOptionsStepProps> = ({ options, onChange, blockingReason }) => (
  <div className={styles.stack}>
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
    <p className={styles.hint}>{UPDATE_HINT}</p>
    {options.updateGeometries && <AlertMessage type={AlertType.WARNING} text={GEOMETRY_OVERWRITE_WARNING} />}

    {blockingReason !== null && <AlertMessage type={AlertType.WARNING} text={blockingReason} />}
  </div>
);
