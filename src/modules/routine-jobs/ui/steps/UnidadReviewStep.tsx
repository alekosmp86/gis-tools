"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { FormField } from "@/ui-kit/components/ui/FormField";
import { AlertType } from "@/ui-kit/types/ui";
import type { UnidadStartRequest } from "../clientTypes";
import { UNIT_GEOMETRY_OVERWRITE_WARNING, type UnidadConfirmation } from "../unidadTerritorialWizardState";
import { PASSWORD_LABEL, ReviewRunActions } from "./reviewParts";
import styles from "./WizardSteps.module.css";

const BUSY_NOTE = "Hay una actualización de unidades territoriales en curso. Espere a que termine para iniciar otra.";
const DRY_RUN_HINT =
  "Analizar sin cargar cuenta y clasifica las unidades, y revierte todo: la tabla de unidades territoriales no cambia.";
const RUN_HINT =
  "Actualizar unidades territoriales modifica la tabla destino. Hace falta escribir de nuevo la contraseña y el nombre de la tabla destino.";
const TYPED_TABLE_LABEL = "Vuelva a escribir el nombre de la tabla de unidades territoriales";
const YES = "Sí";
const NO = "No";

export interface UnidadReviewStepProps {
  request: UnidadStartRequest;
  confirmation: UnidadConfirmation;
  canDryRun: boolean;
  canRun: boolean;
  busy: boolean;
  runBlockedReason: string | null;
  onConfirmationChange: (patch: Partial<UnidadConfirmation>) => void;
  onDryRun: () => void;
  onRun: () => void;
}

export const UnidadReviewStep: React.FC<UnidadReviewStepProps> = ({
  request,
  confirmation,
  canDryRun,
  canRun,
  busy,
  runBlockedReason,
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
        <dt>Tabla de localidades catastrales (origen)</dt>
        <dd>{`${request.localitySchema}.${request.localityTable}`}</dd>
        <dt>Tabla de tipos de unidad territorial</dt>
        <dd>{`${request.typeSchema}.${request.typeTable}`}</dd>
        <dt>Tabla de unidades territoriales (destino)</dt>
        <dd>{`${request.targetSchema}.${request.targetTable}`}</dd>
        <dt>Nombre del tipo de localidad</dt>
        <dd>{options.localityTypeName}</dd>
        <dt>Tolerancia (m)</dt>
        <dd>{String(options.tolerance)}</dd>
        <dt>Actualizar geometrías</dt>
        <dd>{options.updateGeometries ? YES : NO}</dd>
      </dl>

      {options.updateGeometries && <AlertMessage type={AlertType.WARNING} text={UNIT_GEOMETRY_OVERWRITE_WARNING} />}

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
        runLabel="Actualizar unidades territoriales"
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
