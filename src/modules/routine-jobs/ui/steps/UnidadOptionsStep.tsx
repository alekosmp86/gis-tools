"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { FormField } from "@/ui-kit/components/ui/FormField";
import { AlertType } from "@/ui-kit/types/ui";
import { UNIT_GEOMETRY_OVERWRITE_WARNING, type UnidadOptionsDraft } from "../unidadTerritorialWizardState";
import { GeometryOptionFields } from "./GeometryOptionFields";
import styles from "./WizardSteps.module.css";

const TYPE_NAME_LABEL = "Nombre del tipo de localidad";
const TYPE_NAME_HINT =
  "Nombre exacto del tipo de unidad territorial que representa las localidades. Debe existir una sola vez en la tabla de tipos.";
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

    <GeometryOptionFields
      options={options}
      onChange={onChange}
      updateHint={UPDATE_HINT}
      overwriteWarning={UNIT_GEOMETRY_OVERWRITE_WARNING}
    />

    {blockingReason !== null && <AlertMessage type={AlertType.WARNING} text={blockingReason} />}
  </div>
);
