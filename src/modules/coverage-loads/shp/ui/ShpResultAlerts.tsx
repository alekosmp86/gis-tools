"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import { JOB_MODE, JOB_STATE } from "../job/types.ts";
import type { JobStatus } from "../job/types.ts";
import { describeFailure } from "../domain/shpJobView";

interface ShpResultAlertsProps {
  status: JobStatus;
}

const LOAD_SUCCESS = (table: string) => `La carga se completó: public.${table} quedó reemplazada.`;
const TEST_SUCCESS = (table: string) => `La prueba se completó sin modificar public.${table}.`;
const CANCELLED = (table: string) => `La carga fue cancelada: public.${table} no fue modificada.`;
const LEFTOVERS = (tables: readonly string[]) =>
  `La carga terminó, pero quedaron tablas de trabajo sin borrar en la base de datos: ${tables.join(", ")}. Elimínelas a mano cuando no haya otra carga en curso.`;

function outcomeAlert(status: JobStatus): React.ReactNode {
  const { table } = status.target;
  if (status.state === JOB_STATE.SUCCEEDED) {
    return <AlertMessage type={AlertType.SUCCESS} text={status.mode === JOB_MODE.TEST ? TEST_SUCCESS(table) : LOAD_SUCCESS(table)} />;
  }
  if (status.state === JOB_STATE.CANCELLED) return <AlertMessage type={AlertType.WARNING} text={CANCELLED(table)} />;
  const failure = describeFailure(status.error);
  return (
    <>
      <AlertMessage type={AlertType.ERROR} text={failure.title} />
      {failure.detail !== null && <AlertMessage type={AlertType.ERROR} text={failure.detail} />}
    </>
  );
}

export const ShpResultAlerts: React.FC<ShpResultAlertsProps> = ({ status }) => (
  <>
    {outcomeAlert(status)}
    {status.leftovers.length > 0 && <AlertMessage type={AlertType.WARNING} text={LEFTOVERS(status.leftovers)} />}
  </>
);
