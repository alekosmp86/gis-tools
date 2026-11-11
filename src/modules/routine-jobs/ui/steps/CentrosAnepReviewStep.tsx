"use client";

import React from "react";
import { DatabaseZap, Search } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { FormField } from "@/ui-kit/components/ui/FormField";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import { CENTROS_ROLES } from "../../jobs/centros-anep/constants";
import type { CentrosAnepConfirmation } from "../centrosAnepWizardState";
import { CENTROS_CONFIRM_LABEL, CENTROS_ROLE_TITLES } from "../centrosAnepTexts";
import type { CentrosAnepStartRequest } from "../clientTypes";
import { PASSWORD_LABEL } from "./reviewParts";
import styles from "./WizardSteps.module.css";

const BUSY_NOTE = "Hay una carga de centros ANEP en curso. Espere a que termine para iniciar otra.";
const ANALYSIS_HINT = "El análisis no modifica la base de datos: corre en una transacción de solo lectura.";
const LOAD_HINT =
  "Analizar es opcional. Cargar ahora se habilita con la contraseña escrita de nuevo y la confirmación marcada; la carga revisa el staging antes de escribir y se detiene si hay bloqueos.";
const DESTRUCTIVE_WARNING =
  "La carga real vacía la tabla final con DELETE y la vuelve a llenar con los datos de staging, en una sola transacción. Antes de escribir se genera un respaldo para revertir.";
const ICON_SIZE = 15;

export interface CentrosAnepReviewStepProps {
  request: CentrosAnepStartRequest;
  acknowledged: boolean;
  canAnalyze: boolean;
  canLoad: boolean;
  busy: boolean;
  runBlockedReason: string | null;
  onConfirmationChange: (patch: Partial<CentrosAnepConfirmation>) => void;
  onAnalyze: () => void;
  onLoad: () => void;
}

export const CentrosAnepReviewStep: React.FC<CentrosAnepReviewStepProps> = ({
  request,
  acknowledged,
  canAnalyze,
  canLoad,
  busy,
  runBlockedReason,
  onConfirmationChange,
  onAnalyze,
  onLoad,
}) => {
  const { connection, tables } = request;
  const blocked = busy || runBlockedReason !== null;

  return (
    <div className={styles.stack}>
      <dl className={styles.summary}>
        <dt>Servidor</dt>
        <dd>{`${connection.host}:${connection.port}`}</dd>
        <dt>Base de datos</dt>
        <dd>{connection.db_name}</dd>
        <dt>Usuario</dt>
        <dd>{connection.user}</dd>
        {CENTROS_ROLES.map((role) => (
          <React.Fragment key={role}>
            <dt>{CENTROS_ROLE_TITLES[role]}</dt>
            <dd>{`${tables[role].schema}.${tables[role].table}`}</dd>
          </React.Fragment>
        ))}
      </dl>

      <AlertMessage type={AlertType.WARNING} text={DESTRUCTIVE_WARNING} />

      <div className={styles.gridAligned}>
        <FormField label={PASSWORD_LABEL} type="password" onChange={(password) => onConfirmationChange({ password })} />
      </div>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => onConfirmationChange({ acknowledged: event.target.checked })}
        />
        <span>{CENTROS_CONFIRM_LABEL}</span>
      </label>

      <p className={styles.hint}>{ANALYSIS_HINT}</p>
      <p className={styles.hint}>{LOAD_HINT}</p>
      {busy && <AlertMessage type={AlertType.WARNING} text={BUSY_NOTE} />}
      {runBlockedReason !== null && <AlertMessage type={AlertType.WARNING} text={runBlockedReason} />}
      <div className={styles.actions}>
        <Button variant={ButtonVariant.SECONDARY} isDisabled={blocked || !canAnalyze} onClick={onAnalyze}>
          <Search size={ICON_SIZE} />
          <span>Analizar</span>
        </Button>
        <Button isDisabled={blocked || !canLoad} onClick={onLoad}>
          <DatabaseZap size={ICON_SIZE} />
          <span>Cargar ahora</span>
        </Button>
      </div>
    </div>
  );
};
