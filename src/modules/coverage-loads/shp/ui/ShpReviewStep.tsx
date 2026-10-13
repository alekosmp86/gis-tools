"use client";

import React from "react";
import { ClipboardCheck, Play, Trash2 } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import { JOB_MODE } from "../job/types.ts";
import type { ShpJobRef } from "../domain/shpFlowState";
import type { ShpPlan } from "../types";
import { ShpConfirmLoad } from "./ShpConfirmLoad";
import { ShpFileSummary } from "./ShpFileSummary";
import { ShpModeChoice } from "./ShpModeChoice";
import { ShpPlanChecks } from "./ShpPlanChecks";
import { ShpStepCard } from "./ShpStepCard";
import type { ShpFlow } from "./useShpFlow";
import shared from "./ShpShared.module.css";

interface ShpReviewStepProps {
  flow: ShpFlow;
  job: ShpJobRef;
  plan: ShpPlan | null;
}

const NO_PLAN_MESSAGE = "El archivo está en el servidor. Revise el plan contra la base de datos para poder iniciar la carga.";
const BLOCKED_MESSAGE = "La carga no puede iniciarse mientras haya bloqueos o privilegios faltantes.";

export const ShpReviewStep: React.FC<ShpReviewStepProps> = ({ flow, job, plan }) => {
  const { mode, confirmed, error } = flow.state;

  return (
    <ShpStepCard title="Revisión del plan de carga">
      <div className={shared.stack}>
        <ShpFileSummary fileName={job.fileName} sizeBytes={job.sizeBytes} target={job.target} />
        {plan === null && <AlertMessage type={AlertType.INFO} text={NO_PLAN_MESSAGE} />}
        {plan && <ShpPlanChecks plan={plan} />}
        {plan && !plan.canStart && <AlertMessage type={AlertType.ERROR} text={BLOCKED_MESSAGE} />}
        {plan?.canStart && (
          <ShpModeChoice mode={mode} availableModes={plan.availableModes} table={job.target.table} onChange={flow.setMode} />
        )}
        {plan?.canStart && mode === JOB_MODE.LOAD && (
          <ShpConfirmLoad table={job.target.table} isChecked={confirmed} onChange={flow.setConfirmed} />
        )}
        {error && <AlertMessage type={AlertType.ERROR} text={error} />}
        <div className={shared.actions}>
          <Button type="button" variant={ButtonVariant.SECONDARY} onClick={flow.discard}>
            <Trash2 size={15} />
            Descartar archivo
          </Button>
          <Button type="button" variant={ButtonVariant.SECONDARY} isDisabled={!flow.canPlan} onClick={flow.review}>
            <ClipboardCheck size={15} />
            {plan === null ? "Revisar plan" : "Revisar de nuevo"}
          </Button>
          <Button type="button" isDisabled={!flow.canStart} onClick={flow.start}>
            <Play size={15} />
            {mode === JOB_MODE.TEST ? "Iniciar prueba" : "Iniciar carga"}
          </Button>
        </div>
      </div>
    </ShpStepCard>
  );
};
