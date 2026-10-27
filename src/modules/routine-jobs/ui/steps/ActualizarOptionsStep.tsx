"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import { CLEAR_MODE, type ClearMode } from "../../jobs/cargar-padrones/constants";
import type { ActualizarJobOptions } from "../clientTypes";
import { ClearModeFieldset } from "./ClearModeFieldset";
import styles from "./WizardSteps.module.css";

const CLEAR_GROUP_LABEL = "Vaciar tabla de trabajo";
const TRUNCATE_NOTE =
  "TRUNCATE requiere el privilegio TRUNCATE sobre la tabla de trabajo y bloquea la tabla hasta terminar la actualización. Si otra tabla tiene una clave foránea hacia ella, la actualización se rechaza.";

const CLEAR_DESCRIPTIONS: Record<ClearMode, string> = {
  [CLEAR_MODE.DELETE]: "Borra las filas una por una dentro de la transacción. Es la opción predeterminada.",
  [CLEAR_MODE.TRUNCATE]: "Vacía la tabla de una sola vez. Conviene cuando la tabla de trabajo es grande y nadie más la usa durante la actualización.",
};

export interface ActualizarOptionsStepProps {
  options: ActualizarJobOptions;
  onChange: (patch: Partial<ActualizarJobOptions>) => void;
}

export const ActualizarOptionsStep: React.FC<ActualizarOptionsStepProps> = ({ options, onChange }) => (
  <div className={styles.stack}>
    <ClearModeFieldset
      legend={CLEAR_GROUP_LABEL}
      value={options.clearMode}
      descriptions={CLEAR_DESCRIPTIONS}
      onChange={(clearMode) => onChange({ clearMode })}
    />
    {options.clearMode === CLEAR_MODE.TRUNCATE && <AlertMessage type={AlertType.WARNING} text={TRUNCATE_NOTE} />}
  </div>
);
