"use client";

import React from "react";
import { ArrowLeft, DatabaseZap, Loader2 } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import type { IndicatorsPlan } from "../client";
import { collectRejectedRows, listOtherBlockers } from "../domain/planView";
import type { IndicatorsFlow } from "./useIndicatorsFlow";
import { IndicatorsCutPlanCard } from "./IndicatorsCutPlanCard";
import { IndicatorsProblemList } from "./IndicatorsProblemList";
import { IndicatorsShrinkConfirm } from "./IndicatorsShrinkConfirm";
import { IndicatorsStepCard } from "./IndicatorsStepCard";
import { RejectedRowsPanel } from "./RejectedRowsPanel";
import shared from "./IndicatorsShared.module.css";

interface IndicatorsReviewStepProps {
  flow: IndicatorsFlow;
  plan: IndicatorsPlan;
}

const REPLACE_WARNING =
  "Atención: las filas que hoy existen en el histórico con las fechas de estos cortes serán reemplazadas por las filas de los archivos. La operación se confirma con el botón de carga y se hace en una sola transacción.";

export const IndicatorsReviewStep: React.FC<IndicatorsReviewStepProps> = ({ flow, plan }) => {
  const isLoading = flow.isBusy;
  const fileErrorMessages = plan.fileErrors.map((error) => error.message);

  return (
    <IndicatorsStepCard title="Revisión del plan de carga">
      <div className={shared.stack}>
        <IndicatorsProblemList messages={fileErrorMessages} />
        <IndicatorsProblemList messages={listOtherBlockers(plan)} />
        {plan.cuts.length > 0 && <AlertMessage type={AlertType.WARNING} text={REPLACE_WARNING} />}
        {plan.cuts.map((cut) => (
          <IndicatorsCutPlanCard key={cut.fileName} cut={cut} />
        ))}
        <RejectedRowsPanel rows={collectRejectedRows(plan)} />
        {plan.requiresAcceptShrink && (
          <IndicatorsShrinkConfirm
            isChecked={flow.state.acceptShrink}
            isDisabled={isLoading}
            onChange={flow.setAcceptShrink}
          />
        )}
        {flow.state.error && <AlertMessage type={AlertType.ERROR} text={flow.state.error} />}
        <div className={shared.actions}>
          <Button type="button" variant={ButtonVariant.SECONDARY} isDisabled={isLoading} onClick={flow.back}>
            <ArrowLeft size={15} />
            Atrás
          </Button>
          <Button type="button" isDisabled={!flow.canLoad || isLoading} onClick={() => void flow.load()}>
            {isLoading ? <Loader2 size={15} className={shared.spin} /> : <DatabaseZap size={15} />}
            {isLoading ? "Cargando..." : "Cargar al histórico"}
          </Button>
        </div>
      </div>
    </IndicatorsStepCard>
  );
};
