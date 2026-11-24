"use client";

import React from "react";
import { DatabaseZap, Search } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import { EJES_ROLES } from "../../../jobs/ejes-calles/constants";
import type { EjesStartRequest } from "../../shared/clientTypes";
import { EJES_ROLE_TITLES } from "../ejesCallesTexts";
import styles from "../../shared/steps/WizardSteps.module.css";

const BUSY_NOTE = "Hay un trabajo de ejes de calles en curso. Espere a que termine para iniciar otro.";
const ANALYSIS_HINT = "El análisis no modifica la base de datos: corre en una transacción de solo lectura.";
const LOAD_HINT =
  "Cargar ahora se habilita después de analizar estas mismas tablas, sin bloqueos, y con la contraseña de la conexión. También aparece en Resultado junto al informe.";
const ICON_SIZE = 15;

export interface EjesReviewStepProps {
  request: EjesStartRequest;
  canAnalyze: boolean;
  canLoad: boolean;
  busy: boolean;
  runBlockedReason: string | null;
  onAnalyze: () => void;
  onLoad: () => void;
}

export const EjesReviewStep: React.FC<EjesReviewStepProps> = ({
  request,
  canAnalyze,
  canLoad,
  busy,
  runBlockedReason,
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
        {EJES_ROLES.map((role) => (
          <React.Fragment key={role}>
            <dt>{EJES_ROLE_TITLES[role]}</dt>
            <dd>{`${tables[role].schema}.${tables[role].table}`}</dd>
          </React.Fragment>
        ))}
      </dl>

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
