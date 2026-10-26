"use client";

import React from "react";
import { DatabaseZap, Search } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { FormField } from "@/ui-kit/components/ui/FormField";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import { CLEAR_MODE, type ClearMode } from "../../jobs/cargar-padrones/constants";
import type { WizardConfirmation } from "../cargarPadronesWizardState";
import type { StartRequest } from "../clientTypes";
import styles from "./WizardSteps.module.css";

const YES = "Sí";
const NO = "No";
const CLEAR_MODE_NAME: Record<ClearMode, string> = {
  [CLEAR_MODE.DELETE]: "DELETE",
  [CLEAR_MODE.TRUNCATE]: "TRUNCATE",
};
const BUSY_NOTE = "Hay una carga en curso. Espere a que termine para iniciar otra.";
const DRY_RUN_HINT = "Analizar sin cargar ejecuta la carga, cuenta las filas y revierte todo: la tabla destino no cambia.";
const RUN_HINT = "Cargar ahora modifica la tabla destino. Hace falta escribir de nuevo la contraseña y el nombre de la tabla destino.";

const booleanText = (value: boolean): string => (value ? YES : NO);

export interface ReviewStepProps {
  request: StartRequest;
  confirmation: WizardConfirmation;
  confirmed: boolean;
  busy: boolean;
  runBlockedReason: string | null;
  onConfirmationChange: (patch: Partial<WizardConfirmation>) => void;
  onDryRun: () => void;
  onRun: () => void;
}

export const ReviewStep: React.FC<ReviewStepProps> = ({
  request,
  confirmation,
  confirmed,
  busy,
  runBlockedReason,
  onConfirmationChange,
  onDryRun,
  onRun,
}) => {
  const { connection, options } = request;
  const clearName = CLEAR_MODE_NAME[options.clearMode];
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
        <dt>Esquema</dt>
        <dd>{request.schema}</dd>
        <dt>Tabla rural</dt>
        <dd>{request.ruralTable}</dd>
        <dt>Tabla urbana</dt>
        <dd>{request.urbanoTable}</dd>
        <dt>Tabla destino</dt>
        <dd>{request.targetTable}</dd>
        <dt>Reparar geometrías inválidas</dt>
        <dd>{booleanText(options.repair)}</dd>
        <dt>Vaciar tabla destino</dt>
        <dd>{clearName}</dd>
        <dt>Reiniciar secuencias del destino</dt>
        <dd>{booleanText(options.resetSequences)}</dd>
      </dl>

      <AlertMessage
        type={AlertType.ERROR}
        text={`La tabla destino ${request.targetTable} se vaciará con ${clearName} antes de cargar. Si la carga falla antes de confirmarse, la tabla queda como estaba.`}
      />

      <div className={styles.grid}>
        <FormField
          label="Contraseña de la base de datos"
          type="password"
          value={confirmation.password}
          onChange={(password) => onConfirmationChange({ password })}
        />
        <FormField
          label="Vuelva a escribir el nombre de la tabla destino"
          value={confirmation.targetLabel}
          onChange={(targetLabel) => onConfirmationChange({ targetLabel })}
        />
      </div>

      <p className={styles.hint}>{DRY_RUN_HINT}</p>
      <p className={styles.hint}>{RUN_HINT}</p>

      {busy && <AlertMessage type={AlertType.WARNING} text={BUSY_NOTE} />}
      {runBlockedReason !== null && <AlertMessage type={AlertType.WARNING} text={runBlockedReason} />}
      <div className={styles.actions}>
        <Button variant={ButtonVariant.SECONDARY} isDisabled={blocked} onClick={onDryRun}>
          <Search size={15} />
          <span>Analizar sin cargar</span>
        </Button>
        <Button isDisabled={blocked || !confirmed} onClick={onRun}>
          <DatabaseZap size={15} />
          <span>Cargar ahora</span>
        </Button>
      </div>
    </div>
  );
};
