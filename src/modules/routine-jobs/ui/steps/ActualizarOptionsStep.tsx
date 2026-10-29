"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { FormField } from "@/ui-kit/components/ui/FormField";
import { AlertType } from "@/ui-kit/types/ui";
import { GEOMETRY_OVERWRITE_WARNING, type ActualizarOptionsDraft } from "../actualizarPadronWizardState";
import { GeometryOptionFields } from "./GeometryOptionFields";
import styles from "./WizardSteps.module.css";

const LOCALITY_TYPE_LABEL = "Tipo de localidad";
const LOCALITY_TYPE_HINT =
  "Valor de la columna de tipo de unidad que marca las localidades. Se escribe tal cual aparece en la tabla de tipos.";
const UPDATE_HINT =
  "Si está activada, la geometría de los padrones existentes se reemplaza por la del catastro en la actualización real. Las inserciones se aplican igual.";

export interface ActualizarOptionsStepProps {
  options: ActualizarOptionsDraft;
  typeTableChosen: boolean;
  onChange: (patch: Partial<ActualizarOptionsDraft>) => void;
  blockingReason?: string | null;
}

export const ActualizarOptionsStep: React.FC<ActualizarOptionsStepProps> = ({
  options,
  typeTableChosen,
  onChange,
  blockingReason,
}) => (
  <div className={styles.stack}>
    {typeTableChosen && (
      <>
        <FormField label={LOCALITY_TYPE_LABEL} value={options.localityType} onChange={(localityType) => onChange({ localityType })} />
        <p className={styles.hint}>{LOCALITY_TYPE_HINT}</p>
      </>
    )}
    <GeometryOptionFields
      options={options}
      onChange={onChange}
      updateHint={UPDATE_HINT}
      overwriteWarning={GEOMETRY_OVERWRITE_WARNING}
    />
    {blockingReason ? <AlertMessage type={AlertType.WARNING} text={blockingReason} /> : null}
  </div>
);
