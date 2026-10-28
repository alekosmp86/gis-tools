"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { FormField } from "@/ui-kit/components/ui/FormField";
import { AlertType } from "@/ui-kit/types/ui";
import { CLEAR_MODE, type ClearMode } from "../../jobs/cargar-padrones/constants";
import type { ActualizarWizardConfirmation } from "../actualizarPadronWizardState";
import type { ActualizarStartRequest } from "../clientTypes";
import { PASSWORD_LABEL, ReviewRunActions } from "./reviewParts";
import styles from "./WizardSteps.module.css";

const CLEAR_MODE_NAME: Record<ClearMode, string> = {
  [CLEAR_MODE.DELETE]: "DELETE",
  [CLEAR_MODE.TRUNCATE]: "TRUNCATE",
};
const BUSY_NOTE = "Hay una actualización en curso. Espere a que termine para iniciar otra.";
const DRY_RUN_HINT = "Analizar sin cargar ejecuta la carga, cuenta las filas y revierte todo: la tabla de trabajo no cambia.";
const RUN_HINT = "Actualizar tabla de trabajo modifica la tabla de trabajo. Hace falta escribir de nuevo la contraseña y el nombre de la tabla de trabajo.";
const WORK_TABLE_LABEL = "Vuelva a escribir el nombre de la tabla de trabajo";

export interface ActualizarReviewStepProps {
  request: ActualizarStartRequest;
  confirmation: ActualizarWizardConfirmation;
  canDryRun: boolean;
  canRun: boolean;
  busy: boolean;
  runBlockedReason: string | null;
  onConfirmationChange: (patch: Partial<ActualizarWizardConfirmation>) => void;
  onDryRun: () => void;
  onRun: () => void;
}

export const ActualizarReviewStep: React.FC<ActualizarReviewStepProps> = ({
  request,
  canDryRun,
  canRun,
  busy,
  runBlockedReason,
  confirmation,
  onConfirmationChange,
  onDryRun,
  onRun,
}) => {
  const { connection, options } = request;
  const clearName = CLEAR_MODE_NAME[options.clearMode];

  return (
    <div className={styles.stack}>
      <dl className={styles.summary}>
        <dt>Servidor</dt>
        <dd>{`${connection.host}:${connection.port}`}</dd>
        <dt>Base de datos</dt>
        <dd>{connection.db_name}</dd>
        <dt>Usuario</dt>
        <dd>{connection.user}</dd>
        <dt>Esquema de origen</dt>
        <dd>{request.stagingSchema}</dd>
        <dt>Tabla de origen</dt>
        <dd>{request.stagingTable}</dd>
        <dt>Esquema de trabajo</dt>
        <dd>{request.workSchema}</dd>
        <dt>Tabla de trabajo</dt>
        <dd>{request.workTable}</dd>
        <dt>Tabla padrón</dt>
        <dd>{request.padronTable}</dd>
        <dt>Tabla de provincias</dt>
        <dd>{request.provinceTable}</dd>
        <dt>Esquema de carto</dt>
        <dd>{request.cartoSchema}</dd>
        <dt>Tabla de localidades</dt>
        <dd>{request.localityTable}</dd>
        {request.typeTable !== undefined && (
          <>
            <dt>Tabla de tipos de unidad</dt>
            <dd>{request.typeTable}</dd>
            <dt>Tipo de localidad</dt>
            <dd>{options.localityType ?? ""}</dd>
          </>
        )}
        <dt>Vaciar tabla de trabajo</dt>
        <dd>{clearName}</dd>
      </dl>

      <AlertMessage
        type={AlertType.ERROR}
        text={`La tabla de trabajo ${request.workTable} se sobrescribe con ${clearName} antes de cargar. La tabla padrón no se modifica.`}
      />

      <div className={styles.gridAligned}>
        <FormField label={PASSWORD_LABEL} type="password" onChange={(password) => onConfirmationChange({ password })} />
        <FormField
          label={WORK_TABLE_LABEL}
          value={confirmation.workTableLabel}
          onChange={(workTableLabel) => onConfirmationChange({ workTableLabel })}
        />
      </div>

      <ReviewRunActions
        dryRunHint={DRY_RUN_HINT}
        runHint={RUN_HINT}
        busyNote={BUSY_NOTE}
        runLabel="Actualizar tabla de trabajo"
        busy={busy}
        runBlockedReason={runBlockedReason}
        canDryRun={canDryRun}
        canRun={canRun}
        onDryRun={onDryRun}
        onRun={onRun}
      />
    </div>
  );
};
