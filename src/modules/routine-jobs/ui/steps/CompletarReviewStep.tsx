"use client";

import React from "react";
import { FormField } from "@/ui-kit/components/ui/FormField";
import type { CompletarStartRequest } from "../clientTypes";
import { CompletarSlot, type CompletarConfirmation } from "../completarUnidadTerritorialWizardState";
import { PASSWORD_LABEL, ReviewRunActions } from "./reviewParts";
import styles from "./WizardSteps.module.css";

const BUSY_NOTE = "Hay un proceso de direcciones maestras en curso. Espere a que termine para iniciar otro.";
const DRY_RUN_HINT =
  "Analizar sin cargar cuenta y clasifica las unidades, y revierte todo: las tablas de unidades territoriales y de direcciones maestras no cambian.";
const RUN_HINT =
  "Completar unidades territoriales modifica las dos tablas. Hace falta escribir de nuevo la contraseña y el nombre de cada tabla.";
const TYPED_UNIT_LABEL = "Vuelva a escribir el nombre de la tabla de unidades territoriales";
const TYPED_ADDRESS_MASTER_LABEL = "Vuelva a escribir el nombre de la tabla de direcciones maestras";

export interface CompletarReviewStepProps {
  request: CompletarStartRequest;
  confirmation: CompletarConfirmation;
  canDryRun: boolean;
  canRun: boolean;
  busy: boolean;
  runBlockedReason: string | null;
  onPasswordChange: (password: string) => void;
  onTypedTableChange: (key: CompletarSlot, value: string) => void;
  onDryRun: () => void;
  onRun: () => void;
}

export const CompletarReviewStep: React.FC<CompletarReviewStepProps> = ({
  request,
  confirmation,
  canDryRun,
  canRun,
  busy,
  runBlockedReason,
  onPasswordChange,
  onTypedTableChange,
  onDryRun,
  onRun,
}) => {
  const { connection } = request;

  return (
    <div className={styles.stack}>
      <dl className={styles.summary}>
        <dt>Servidor</dt>
        <dd>{`${connection.host}:${connection.port}`}</dd>
        <dt>Base de datos</dt>
        <dd>{connection.db_name}</dd>
        <dt>Usuario</dt>
        <dd>{connection.user}</dd>
        <dt>Tabla de unidades territoriales</dt>
        <dd>{`${request.unitSchema}.${request.unitTable}`}</dd>
        <dt>Tabla de direcciones maestras</dt>
        <dd>{`${request.addressMasterSchema}.${request.addressMasterTable}`}</dd>
      </dl>

      <div className={styles.gridAligned}>
        <FormField label={PASSWORD_LABEL} type="password" onChange={onPasswordChange} />
        <FormField
          label={TYPED_UNIT_LABEL}
          value={confirmation.typedTables[CompletarSlot.UNIT]}
          onChange={(value) => onTypedTableChange(CompletarSlot.UNIT, value)}
        />
        <FormField
          label={TYPED_ADDRESS_MASTER_LABEL}
          value={confirmation.typedTables[CompletarSlot.ADDRESS_MASTER]}
          onChange={(value) => onTypedTableChange(CompletarSlot.ADDRESS_MASTER, value)}
        />
      </div>

      <ReviewRunActions
        dryRunHint={DRY_RUN_HINT}
        runHint={RUN_HINT}
        busyNote={BUSY_NOTE}
        runLabel="Completar unidades territoriales"
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
