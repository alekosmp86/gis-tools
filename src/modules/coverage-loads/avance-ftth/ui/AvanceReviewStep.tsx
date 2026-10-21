"use client";

import React from "react";
import { ArrowLeft, DatabaseZap, FlaskConical } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import type { AvancePlan } from "../client";
import { RunMode } from "../domain/loadFlow";
import { collectRejectedRows, listOtherBlockers } from "../domain/planView";
import type { AvanceFtthFlow } from "./useAvanceFtthFlow";
import { AvanceCollapsibleWarnings } from "./AvanceCollapsibleWarnings";
import { AvanceCurrentState } from "./AvanceCurrentState";
import { AvanceFilePlanCard } from "./AvanceFilePlanCard";
import { AvanceMessageList } from "./AvanceMessageList";
import { AvanceStatusTable } from "./AvanceStatusTable";
import { AvanceStepCard } from "./AvanceStepCard";
import { RejectedRowsPanel } from "./RejectedRowsPanel";
import shared from "./AvanceShared.module.css";

interface AvanceReviewStepProps {
  flow: AvanceFtthFlow;
  plan: AvancePlan;
}

const REPLACE_WARNING =
  "Atención: el Avance actual se copia al historial y se reemplaza por el resultado de cruzar las dos planillas con las zonas de SIGRA, y las dos tablas de planillas se reemplazan por los archivos. Todo se hace en una sola transacción.";
const LOCK_WARNING =
  "Tanto «Probar sin guardar» como «Cargar y reemplazar» se ejecutan en una sola transacción: otras cargas esperan mientras dura la operación, y el Avance publicado sigue disponible para consultar hasta la confirmación.";
const DRY_RUN_HINT =
  "«Probar sin guardar» ejecuta toda la carga y los cinco reportes dentro de la transacción y la deshace al final: no queda nada guardado.";

export const AvanceReviewStep: React.FC<AvanceReviewStepProps> = ({ flow, plan }) => {
  const fileErrorMessages = plan.fileErrors.map((error) => error.message);
  const rejectedRows = collectRejectedRows(plan);
  const totalRejected = plan.files.reduce((total, file) => total + file.rejectedTotal, 0);

  return (
    <AvanceStepCard title="Revisión del plan de carga">
      <div className={shared.stack}>
        <AvanceMessageList messages={fileErrorMessages} type={AlertType.ERROR} />
        <AvanceMessageList messages={listOtherBlockers(plan)} type={AlertType.ERROR} />
        <AvanceCollapsibleWarnings messages={[REPLACE_WARNING, LOCK_WARNING, ...plan.warnings]} />
        {plan.files.map((file) => (
          <AvanceFilePlanCard key={file.fileName} file={file} currentRows={plan.staging[file.kind].rows} />
        ))}
        <AvanceCurrentState plan={plan} />
        <AvanceStatusTable plan={plan} />
        <RejectedRowsPanel rows={rejectedRows} totalRejected={totalRejected} />
        <p className={shared.hint}>{DRY_RUN_HINT}</p>
        {flow.state.error && <AlertMessage type={AlertType.ERROR} text={flow.state.error} />}
        <div className={shared.actions}>
          <Button type="button" variant={ButtonVariant.SECONDARY} onClick={flow.back}>
            <ArrowLeft size={15} />
            Atrás
          </Button>
          <Button
            type="button"
            variant={ButtonVariant.SECONDARY}
            isDisabled={!flow.canRun}
            onClick={() => void flow.run(RunMode.DRY_RUN)}
          >
            <FlaskConical size={15} />
            Probar sin guardar
          </Button>
          <Button type="button" isDisabled={!flow.canRun} onClick={() => void flow.run(RunMode.LOAD)}>
            <DatabaseZap size={15} />
            Cargar y reemplazar
          </Button>
        </div>
      </div>
    </AvanceStepCard>
  );
};
