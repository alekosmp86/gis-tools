"use client";

import React from "react";
import { DatabaseZap, Search } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { FormField } from "@/ui-kit/components/ui/FormField";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import type { LocalidadesConfirmation } from "../cargarLocalidadesWizardState";
import { GEOMETRY_OVERWRITE_WARNING } from "../cargarLocalidadesWizardState";
import type { LocalidadesStartRequest } from "../clientTypes";
import styles from "./WizardSteps.module.css";

const BUSY_NOTE = "Hay una carga de localidades en curso. Espere a que termine para iniciar otra.";
const DRY_RUN_HINT = "Analizar sin cargar cuenta y clasifica las localidades, y revierte todo: las tablas de localidades no cambian.";
const RUN_HINT =
  "Cargar localidades modifica las tablas de localidades destino. Hace falta escribir de nuevo la contraseña y el nombre de cada tabla destino.";
const PASSWORD_LABEL = "Contraseña de la base de datos";
const TYPED_TABLE_LABEL = (position: number): string => `Vuelva a escribir el nombre de la tabla destino ${position}`;
const YES = "Sí";
const NO = "No";

export interface LocalidadesReviewStepProps {
  request: LocalidadesStartRequest;
  confirmation: LocalidadesConfirmation;
  canDryRun: boolean;
  canRun: boolean;
  busy: boolean;
  runBlockedReason: string | null;
  onConfirmationChange: (patch: Partial<LocalidadesConfirmation>) => void;
  onDryRun: () => void;
  onRun: () => void;
}

const typedAt = (typedTables: readonly string[], index: number): string => typedTables[index] ?? "";

const withTypedAt = (typedTables: readonly string[], index: number, value: string, count: number): string[] =>
  Array.from({ length: count }, (_slot, slotIndex) => (slotIndex === index ? value : typedAt(typedTables, slotIndex)));

export const LocalidadesReviewStep: React.FC<LocalidadesReviewStepProps> = ({
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
  const { connection, options, targets } = request;
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
        {targets.map((target, index) => (
          <React.Fragment key={`${target.schema}.${target.table}`}>
            <dt>{`Tabla de localidades destino ${index + 1}`}</dt>
            <dd>{`${target.schema}.${target.table}`}</dd>
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
        {targets.map((target, index) => (
          <FormField
            key={`${target.schema}.${target.table}`}
            label={TYPED_TABLE_LABEL(index + 1)}
            value={typedAt(confirmation.typedTables, index)}
            onChange={(value) =>
              onConfirmationChange({ typedTables: withTypedAt(confirmation.typedTables, index, value, targets.length) })
            }
          />
        ))}
      </div>

      <p className={styles.hint}>{DRY_RUN_HINT}</p>
      <p className={styles.hint}>{RUN_HINT}</p>

      {busy && <AlertMessage type={AlertType.WARNING} text={BUSY_NOTE} />}
      {runBlockedReason !== null && <AlertMessage type={AlertType.WARNING} text={runBlockedReason} />}
      <div className={styles.actions}>
        <Button variant={ButtonVariant.SECONDARY} isDisabled={blocked || !canDryRun} onClick={onDryRun}>
          <Search size={15} />
          <span>Analizar sin cargar</span>
        </Button>
        <Button isDisabled={blocked || !canRun} onClick={onRun}>
          <DatabaseZap size={15} />
          <span>Cargar localidades</span>
        </Button>
      </div>
    </div>
  );
};
