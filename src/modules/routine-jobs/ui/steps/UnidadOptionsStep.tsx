"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { FormField } from "@/ui-kit/components/ui/FormField";
import { AlertType } from "@/ui-kit/types/ui";
import { UNIT_GEOMETRY_OVERWRITE_WARNING, type UnidadOptionsDraft } from "../unidadTerritorialWizardState";
import styles from "./WizardSteps.module.css";

const TYPE_NAME_LABEL = "Nombre del tipo de localidad";
const TYPE_NAME_HINT =
  "Nombre exacto del tipo de unidad territorial que representa las localidades. Debe existir una sola vez en la tabla de tipos.";
const TOLERANCE_LABEL = "Tolerancia (m)";
const TOLERANCE_HINT =
  "Distancia de Hausdorff en metros por debajo de la cual una geometría se considera sin cambios. Predeterminado: 1,0 m.";
const UPDATE_LABEL = "Actualizar geometrías";
const UPDATE_HINT =
  "Si está activada, la geometría de las unidades cuya localidad cambió se reemplaza en la carga real. Las inserciones y el cambio de fuente se aplican igual.";

export interface UnidadOptionsStepProps {
  options: UnidadOptionsDraft;
  onChange: (patch: Partial<UnidadOptionsDraft>) => void;
  blockingReason: string | null;
}

export const UnidadOptionsStep: React.FC<UnidadOptionsStepProps> = ({ options, onChange, blockingReason }) => (
  <div className={styles.stack}>
    <FormField label={TYPE_NAME_LABEL} value={options.localityTypeName} onChange={(localityTypeName) => onChange({ localityTypeName })} />
    <p className={styles.hint}>{TYPE_NAME_HINT}</p>

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
    {options.updateGeometries && <AlertMessage type={AlertType.WARNING} text={UNIT_GEOMETRY_OVERWRITE_WARNING} />}

    {blockingReason !== null && <AlertMessage type={AlertType.WARNING} text={blockingReason} />}
  </div>
);
