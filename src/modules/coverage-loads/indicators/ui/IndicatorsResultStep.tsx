"use client";

import React from "react";
import { RotateCcw } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType } from "@/ui-kit/types/ui";
import type { LoadResult } from "../client";
import { listIncompleteMessages } from "../domain/planView";
import type { IndicatorsFlow } from "./useIndicatorsFlow";
import { IndicatorsLoadedCuts } from "./IndicatorsLoadedCuts";
import { IndicatorsStepCard } from "./IndicatorsStepCard";
import { RejectedRowsPanel } from "./RejectedRowsPanel";
import shared from "./IndicatorsShared.module.css";

interface IndicatorsResultStepProps {
  flow: IndicatorsFlow;
  result: LoadResult;
}

const SUCCESS_MESSAGE = "La carga se completó y quedó confirmada en el histórico.";
const INCOMPLETE_MESSAGE =
  "Corte incompleto: al menos un corte perdió filas rechazadas. Los reportes (paso Resultado) se generan igualmente, pero reflejan un corte incompleto. Corrija el archivo y vuelva a cargarlo para restaurar el corte completo.";

export const IndicatorsResultStep: React.FC<IndicatorsResultStepProps> = ({ flow, result }) => (
  <IndicatorsStepCard title="Resultado de la carga">
    <div className={shared.stack}>
      <AlertMessage type={AlertType.SUCCESS} text={SUCCESS_MESSAGE} />
      {result.hasIncompleteCut && <AlertMessage type={AlertType.WARNING} text={INCOMPLETE_MESSAGE} />}
      {listIncompleteMessages(result).map((message) => (
        <AlertMessage key={message} type={AlertType.WARNING} text={message} />
      ))}
      <IndicatorsLoadedCuts result={result} />
      <RejectedRowsPanel rows={result.rejectedRows} />
      <div className={shared.actions}>
        <Button type="button" onClick={flow.restart}>
          <RotateCcw size={15} />
          Nueva carga
        </Button>
      </div>
    </div>
  </IndicatorsStepCard>
);
