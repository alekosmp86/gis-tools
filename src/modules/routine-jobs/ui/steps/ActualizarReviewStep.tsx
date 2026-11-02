"use client";

import React from "react";
import { Search } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { FormField } from "@/ui-kit/components/ui/FormField";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import { MONTHLY_TABLES } from "../../config/monthlyTables";
import { GEOMETRY_OVERWRITE_WARNING, type ActualizarWizardConfirmation } from "../actualizarPadronWizardState";
import type { ActualizarStartRequest } from "../clientTypes";
import { PASSWORD_LABEL } from "./reviewParts";
import styles from "./WizardSteps.module.css";

const BUSY_NOTE = "Hay un análisis en curso. Espere a que termine para iniciar otro.";
const CONTENT_NOTE = "Al guardar, inserta los padrones nuevos y actualiza la geometría de los existentes. Nunca borra filas ni cambia ids.";
const ANALYSIS_HINT = "El análisis no modifica la base de datos. Los cambios se guardan después, desde el resultado del análisis.";
const NON_PADRON_TARGET_WARNING =
  "La tabla de destino no es «padron»: se crearán direcciones maestras reales para los ids de esa tabla.";
const ANALYZE_ICON_SIZE = 15;
const YES = "Sí";
const NO = "No";

const pairChoiceTextOf = (count: number): string =>
  count === 1 ? "1 elección de par incluida" : `${count} elecciones de par incluidas`;

const acceptedGeometryTextOf = (count: number): string =>
  count === 1 ? "1 geometría aceptada incluida" : `${count} geometrías aceptadas incluidas`;

/** The review decisions the analysis will send: the pair choices and the accepted geometries, each only when there is one. */
function DecisionSummary({ options }: { options: ActualizarStartRequest["options"] }) {
  const pairChoiceCount = options.pairChoices?.length ?? 0;
  const acceptedGeometryCount = options.acceptedGeometries?.length ?? 0;
  return (
    <>
      {pairChoiceCount > 0 && (
        <>
          <dt>Elecciones de par</dt>
          <dd>{pairChoiceTextOf(pairChoiceCount)}</dd>
        </>
      )}
      {acceptedGeometryCount > 0 && (
        <>
          <dt>Geometrías aceptadas</dt>
          <dd>{acceptedGeometryTextOf(acceptedGeometryCount)}</dd>
        </>
      )}
    </>
  );
}

export interface ActualizarReviewStepProps {
  request: ActualizarStartRequest;
  confirmation: ActualizarWizardConfirmation;
  canAnalyze: boolean;
  busy: boolean;
  runBlockedReason: string | null;
  onConfirmationChange: (patch: Partial<ActualizarWizardConfirmation>) => void;
  onAnalyze: () => void;
}

export const ActualizarReviewStep: React.FC<ActualizarReviewStepProps> = ({
  request,
  canAnalyze,
  busy,
  runBlockedReason,
  confirmation,
  onConfirmationChange,
  onAnalyze,
}) => {
  const { connection, options } = request;
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
        <DecisionSummary options={options} />
      </dl>

      <AlertMessage type={AlertType.INFO} text={CONTENT_NOTE} />
      {options.updateGeometries && <AlertMessage type={AlertType.WARNING} text={GEOMETRY_OVERWRITE_WARNING} />}
      {options.linkAddressMaster && request.targetTable !== MONTHLY_TABLES.actualizarPadrones.target.table && (
        <AlertMessage type={AlertType.WARNING} text={NON_PADRON_TARGET_WARNING} />
      )}

      <FormField
        label={PASSWORD_LABEL}
        type="password"
        value={confirmation.password}
        onChange={(password) => onConfirmationChange({ password })}
      />

      <p className={styles.hint}>{ANALYSIS_HINT}</p>
      {busy && <AlertMessage type={AlertType.WARNING} text={BUSY_NOTE} />}
      {runBlockedReason !== null && <AlertMessage type={AlertType.WARNING} text={runBlockedReason} />}
      <div className={styles.actions}>
        <Button variant={ButtonVariant.PRIMARY} isDisabled={blocked || !canAnalyze} onClick={onAnalyze}>
          <Search size={ANALYZE_ICON_SIZE} />
          <span>Analizar</span>
        </Button>
      </div>
    </div>
  );
};
