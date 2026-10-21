"use client";

import React, { useState } from "react";
import { ListChecks } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import type { StagePanelProps } from "../../shared/domain/stageContract";
import { listGeneralBlockers } from "../domain/planView";
import { SigraFlowPhase } from "../domain/sigraFlow";
import { SigraBusyNotice } from "./SigraBusyNotice";
import { SigraLayerTable } from "./SigraLayerTable";
import { SigraMessageList } from "./SigraMessageList";
import { SigraResultModal } from "./SigraResultModal";
import { SigraRunActions } from "./SigraRunActions";
import { SigraSelectionToolbar } from "./SigraSelectionToolbar";
import { SigraStepCard } from "./SigraStepCard";
import { useSigraLayersFlow } from "./useSigraLayersFlow";
import shared from "./SigraShared.module.css";

const INTRO_TEXT =
  "Las dos capas obligatorias (zonas FTTH y límites de centrales FTTH) son las que necesita el Avance FTTH y se cargan siempre juntas. Las capas opcionales se cargan por si hacen falta más adelante y no condicionan ningún paso.";
const REPLACE_HINT =
  "«Cargar y reemplazar» descarga cada capa seleccionada desde SIGRA y reemplaza su tabla solo si el resultado supera la validación. «Probar sin guardar» hace todo el recorrido y deshace el resultado: no queda nada guardado.";
const PLANNING_TEXT = "Consultando el estado de las capas...";
const RUNNING_TEXT = "Cargando las capas seleccionadas desde SIGRA. Puede tardar varios minutos.";

function busyText(phase: SigraFlowPhase): string | null {
  if (phase === SigraFlowPhase.PLANNING) return PLANNING_TEXT;
  return phase === SigraFlowPhase.RUNNING ? RUNNING_TEXT : null;
}

/** The "Capas SIGRA" stage: current state of each layer, a selection, and a dry or real run with its result. */
export const SigraLayersPanel: React.FC<StagePanelProps> = ({ connection, connectionRevision, onStatusChange }) => {
  const flow = useSigraLayersFlow(connection, connectionRevision, onStatusChange);
  const { phase, plan, selection, results, lastRunDryRun, error } = flow.state;
  const [closedResults, setClosedResults] = useState<typeof results | null>(null);
  const notice = busyText(phase);
  const isBusy = notice !== null;
  const hasResults = results.length > 0;
  const showResult = hasResults && !isBusy && closedResults !== results;

  return (
    <SigraStepCard title="Capas SIGRA">
      <div className={shared.stack}>
        <p className={shared.hint}>{INTRO_TEXT}</p>
        <SigraSelectionToolbar
          isBusy={isBusy}
          onRefresh={flow.refresh}
          onSelectAll={flow.selectAll}
          onSelectRequiredOnly={flow.selectRequiredOnly}
        />
        {notice !== null && <SigraBusyNotice text={notice} />}
        {plan && (
          <>
            <SigraMessageList messages={listGeneralBlockers(plan)} type={AlertType.ERROR} />
            <SigraMessageList messages={plan.warnings} type={AlertType.WARNING} />
            <SigraLayerTable plan={plan} selection={selection} disabled={isBusy} onToggle={flow.toggleLayer} />
          </>
        )}
        {error && <AlertMessage type={AlertType.ERROR} text={error} />}
        <p className={shared.hint}>{REPLACE_HINT}</p>
        <SigraRunActions
          canRun={flow.canRun}
          busy={isBusy}
          selectedLayerIds={selection}
          onDryRun={flow.runDryRun}
          onLoad={flow.runLoad}
        />
        {hasResults && !isBusy && (
          <div className={shared.actions}>
            <Button type="button" variant={ButtonVariant.SECONDARY} onClick={() => setClosedResults(null)}>
              <ListChecks size={15} />
              Ver último resultado
            </Button>
          </div>
        )}
      </div>
      {showResult && (
        <SigraResultModal results={results} dryRun={lastRunDryRun === true} onClose={() => setClosedResults(results)} />
      )}
    </SigraStepCard>
  );
};
