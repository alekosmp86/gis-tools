"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { FormField } from "@/ui-kit/components/ui/FormField";
import { AlertType } from "@/ui-kit/types/ui";
import { DEFAULT_PADRON_TARGET_TABLE } from "../../jobs/actualizar-padron/constants";
import { GEOMETRY_OVERWRITE_WARNING, type ActualizarWizardConfirmation } from "../actualizarPadronWizardState";
import type { ActualizarStartRequest } from "../clientTypes";
import { PASSWORD_LABEL, ReviewRunActions } from "./reviewParts";
import styles from "./WizardSteps.module.css";

const BUSY_NOTE = "Hay una actualización en curso. Espere a que termine para iniciar otra.";
const CONTENT_NOTE = "Inserta los padrones nuevos y actualiza la geometría de los existentes. Nunca borra filas ni cambia ids.";
const DRY_RUN_HINT = "Analizar sin cargar clasifica los padrones y revierte todo: la tabla de destino no cambia.";
const RUN_HINT = "Actualizar padrones modifica la tabla de destino. Hace falta escribir de nuevo la contraseña y el nombre de la tabla de destino.";
const NON_PADRON_TARGET_WARNING =
  "La tabla de destino no es «padron»: se crearán direcciones maestras reales para los ids de esa tabla.";
const TYPED_TABLE_LABEL = "Vuelva a escribir el nombre de la tabla de destino";
const YES = "Sí";
const NO = "No";

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
        <dt>Esquema de carto</dt>
        <dd>{request.cartoSchema}</dd>
        <dt>Tabla de destino</dt>
        <dd>{request.targetTable}</dd>
        <dt>Tabla de provincias</dt>
        <dd>{request.provinceTable}</dd>
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
        <dt>Tolerancia (m)</dt>
        <dd>{String(options.tolerance)}</dd>
        <dt>Actualizar geometrías</dt>
        <dd>{options.updateGeometries ? YES : NO}</dd>
        <dt>Enlazar direcciones maestras de padrones</dt>
        <dd>{options.linkAddressMaster ? YES : NO}</dd>
        {request.addressMasterTable !== undefined && (
          <>
            <dt>Tabla de direcciones maestras</dt>
            <dd>{request.addressMasterTable}</dd>
          </>
        )}
      </dl>

      <AlertMessage type={AlertType.INFO} text={CONTENT_NOTE} />
      {options.updateGeometries && <AlertMessage type={AlertType.WARNING} text={GEOMETRY_OVERWRITE_WARNING} />}
      {options.linkAddressMaster && request.targetTable !== DEFAULT_PADRON_TARGET_TABLE && (
        <AlertMessage type={AlertType.WARNING} text={NON_PADRON_TARGET_WARNING} />
      )}

      <div className={styles.gridAligned}>
        <FormField label={PASSWORD_LABEL} type="password" onChange={(password) => onConfirmationChange({ password })} />
        <FormField
          label={TYPED_TABLE_LABEL}
          value={confirmation.typedTable}
          onChange={(typedTable) => onConfirmationChange({ typedTable })}
        />
      </div>

      <ReviewRunActions
        dryRunHint={DRY_RUN_HINT}
        runHint={RUN_HINT}
        busyNote={BUSY_NOTE}
        runLabel="Actualizar padrones"
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
