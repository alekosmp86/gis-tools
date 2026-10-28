"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { FormField } from "@/ui-kit/components/ui/FormField";
import { AlertType } from "@/ui-kit/types/ui";
import type { LocalidadesConfirmation, LocalidadesIncludedTarget } from "../cargarLocalidadesWizardState";
import { DESTINATION_TITLE, GEOMETRY_OVERWRITE_WARNING } from "../cargarLocalidadesWizardState";
import type { LocalidadesStartRequest } from "../clientTypes";
import { PASSWORD_LABEL, ReviewRunActions } from "./reviewParts";
import styles from "./WizardSteps.module.css";

const BUSY_NOTE = "Hay una carga de localidades en curso. Espere a que termine para iniciar otra.";
const DRY_RUN_HINT = "Analizar sin cargar cuenta y clasifica las localidades, y revierte todo: las tablas de localidades no cambian.";
const RUN_HINT =
  "Cargar localidades modifica las tablas de localidades destino. Hace falta escribir de nuevo la contraseña y el nombre de cada tabla destino.";
const TYPED_TABLE_LABEL = (destinationTitle: string): string => `Vuelva a escribir el nombre de la tabla (${destinationTitle})`;
const YES = "Sí";
const NO = "No";

export interface LocalidadesReviewStepProps {
  request: LocalidadesStartRequest;
  targets: LocalidadesIncludedTarget[];
  confirmation: LocalidadesConfirmation;
  canDryRun: boolean;
  canRun: boolean;
  busy: boolean;
  runBlockedReason: string | null;
  onConfirmationChange: (patch: Partial<LocalidadesConfirmation>) => void;
  onDryRun: () => void;
  onRun: () => void;
}

const routeOf = (target: LocalidadesIncludedTarget): string => `${target.schema}.${target.table}`;

export const LocalidadesReviewStep: React.FC<LocalidadesReviewStepProps> = ({
  request,
  targets,
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
        <dt>Esquema de padrones y localidades de origen</dt>
        <dd>{request.stagingSchema}</dd>
        <dt>Tabla de padrones</dt>
        <dd>{request.padronTable}</dd>
        <dt>Tabla de localidades de origen</dt>
        <dd>{request.localityStagingTable}</dd>
        <dt>Esquema de provincias</dt>
        <dd>{request.provinceSchema}</dd>
        <dt>Tabla de provincias</dt>
        <dd>{request.provinceTable}</dd>
        {targets.map((target) => (
          <React.Fragment key={target.destination}>
            <dt>{DESTINATION_TITLE[target.destination]}</dt>
            <dd>{routeOf(target)}</dd>
          </React.Fragment>
        ))}
        <dt>Tolerancia (m)</dt>
        <dd>{String(options.tolerance)}</dd>
        <dt>Actualizar geometrías</dt>
        <dd>{options.updateGeometries ? YES : NO}</dd>
      </dl>

      {options.updateGeometries && <AlertMessage type={AlertType.WARNING} text={GEOMETRY_OVERWRITE_WARNING} />}

      <div className={styles.gridAligned}>
        <FormField label={PASSWORD_LABEL} type="password" onChange={(password) => onConfirmationChange({ password })} />
        {targets.map((target) => (
          <FormField
            key={target.destination}
            label={TYPED_TABLE_LABEL(DESTINATION_TITLE[target.destination])}
            value={confirmation.typedTables[target.destination]}
            onChange={(value) =>
              onConfirmationChange({ typedTables: { ...confirmation.typedTables, [target.destination]: value } })
            }
          />
        ))}
      </div>

      <ReviewRunActions
        dryRunHint={DRY_RUN_HINT}
        runHint={RUN_HINT}
        busyNote={BUSY_NOTE}
        runLabel="Cargar localidades"
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
