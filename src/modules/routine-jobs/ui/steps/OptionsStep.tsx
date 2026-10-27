"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import { CLEAR_MODE, type ClearMode } from "../../jobs/cargar-padrones/constants";
import type { JobOptions } from "../clientTypes";
import { ClearModeFieldset } from "./ClearModeFieldset";
import styles from "./WizardSteps.module.css";

const REPAIR_LABEL = "Reparar geometrías inválidas";
const REPAIR_HINT = "Corrige con ST_MakeValid las geometrías inválidas antes de agrupar. Las válidas no se tocan. Predeterminado: sí.";
const CLEAR_GROUP_LABEL = "Vaciar tabla destino";
const SEQUENCES_LABEL = "Reiniciar secuencias del destino";
const SEQUENCES_HINT = "Reinicia las secuencias de las columnas que no se cargan y las repara al terminar. Predeterminado: sí.";
const TRUNCATE_NOTE =
  "TRUNCATE requiere el privilegio TRUNCATE sobre la tabla destino y bloquea la tabla hasta terminar la carga. Si otra tabla tiene una clave foránea hacia el destino, la carga se rechaza.";

const CLEAR_DESCRIPTIONS: Record<ClearMode, string> = {
  [CLEAR_MODE.DELETE]: "Borra las filas una por una dentro de la transacción. Es la opción predeterminada.",
  [CLEAR_MODE.TRUNCATE]: "Vacía la tabla de una sola vez. Conviene cuando la tabla destino es grande y nadie más la usa durante la carga.",
};

export interface OptionsStepProps {
  options: JobOptions;
  onChange: (patch: Partial<JobOptions>) => void;
}

export const OptionsStep: React.FC<OptionsStepProps> = ({ options, onChange }) => (
  <div className={styles.stack}>
    <label className={styles.checkRow}>
      <input type="checkbox" checked={options.repair} onChange={(event) => onChange({ repair: event.target.checked })} />
      <span>{REPAIR_LABEL}</span>
    </label>
    <p className={styles.hint}>{REPAIR_HINT}</p>

    <ClearModeFieldset
      legend={CLEAR_GROUP_LABEL}
      value={options.clearMode}
      descriptions={CLEAR_DESCRIPTIONS}
      onChange={(clearMode) => onChange({ clearMode })}
    />
    {options.clearMode === CLEAR_MODE.TRUNCATE && <AlertMessage type={AlertType.WARNING} text={TRUNCATE_NOTE} />}

    <label className={styles.checkRow}>
      <input
        type="checkbox"
        checked={options.resetSequences}
        onChange={(event) => onChange({ resetSequences: event.target.checked })}
      />
      <span>{SEQUENCES_LABEL}</span>
    </label>
    <p className={styles.hint}>{SEQUENCES_HINT}</p>
  </div>
);
