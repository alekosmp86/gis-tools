"use client";

import React from "react";
import type { StagePanelProps } from "../../shared/domain/stageContract";
import { ShpPhase } from "../domain/shpFlowState";
import { ShpBusyCard } from "./ShpBusyCard";
import { ShpPickStep } from "./ShpPickStep";
import { ShpResultStep } from "./ShpResultStep";
import { ShpReviewStep } from "./ShpReviewStep";
import { ShpRunStep } from "./ShpRunStep";
import { ShpUploadStep } from "./ShpUploadStep";
import { useShpFlow, type ShpFlow } from "./useShpFlow";

function renderPhase(flow: ShpFlow): React.ReactNode {
  const { phase, job, plan, status } = flow.state;
  switch (phase) {
    case ShpPhase.RESUMING:
      return <ShpBusyCard title="Archivo SHP" message="Buscando cargas pendientes o en curso..." />;
    case ShpPhase.PICK:
      return <ShpPickStep flow={flow} />;
    case ShpPhase.UPLOADING:
      return <ShpUploadStep flow={flow} />;
    case ShpPhase.PLANNING:
      return <ShpBusyCard title="Revisión del plan de carga" message="Analizando la base de datos. No se escribe nada en este paso." />;
    case ShpPhase.REVIEW:
      return job ? <ShpReviewStep flow={flow} job={job} plan={plan} /> : null;
    case ShpPhase.STARTING:
      return <ShpBusyCard title="Iniciando la carga" message="Verificando el plan y lanzando el proceso de carga..." />;
    case ShpPhase.RUNNING:
      return job ? <ShpRunStep flow={flow} job={job} /> : null;
    case ShpPhase.DONE:
      return job && status ? <ShpResultStep flow={flow} job={job} status={status} /> : null;
  }
}

/** The "Cargas SHP" stage: pick the file, review the plan, follow the running job, see the result. */
export const ShpPanel: React.FC<StagePanelProps> = ({ connection, connectionRevision, onStatusChange }) => {
  const flow = useShpFlow(connection, connectionRevision, onStatusChange);

  return <>{renderPhase(flow)}</>;
};
