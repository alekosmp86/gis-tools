"use client";

import React from "react";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { formatNumber } from "@/core/common/ValueFormatter";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import type { AvanceLoadResult } from "../client";
import type { AvanceFtthFlow } from "./useAvanceFtthFlow";
import { AvanceCollapsibleWarnings } from "./AvanceCollapsibleWarnings";
import { AvanceResultTables } from "./AvanceResultTables";
import { AvanceStepCard } from "./AvanceStepCard";
import { RejectedRowsPanel } from "./RejectedRowsPanel";
import shared from "./AvanceShared.module.css";

interface AvanceResultStepProps {
  flow: AvanceFtthFlow;
  result: AvanceLoadResult;
}

const SUCCESS_MESSAGE =
  "La carga se completó y quedó confirmada. Los reportes se descargan desde el paso Resultado del flujo.";
const DRY_RUN_MESSAGE =
  "Prueba sin guardar completada: se ejecutó toda la carga y los reportes, y se deshizo al final. No quedó nada guardado.";

function describeHistory(result: AvanceLoadResult): string {
  const { history } = result;
  return history.skipped
    ? (history.reason ?? "Historial omitido.")
    : `${formatNumber(history.copied)} filas del Avance anterior copiadas al historial.`;
}

export const AvanceResultStep: React.FC<AvanceResultStepProps> = ({ flow, result }) => (
  <AvanceStepCard title={result.dryRun ? "Resultado de la prueba" : "Resultado de la carga"}>
    <div className={shared.stack}>
      <AlertMessage type={AlertType.SUCCESS} text={result.dryRun ? DRY_RUN_MESSAGE : SUCCESS_MESSAGE} />
      <AvanceCollapsibleWarnings messages={result.warnings} />
      <p className={shared.hint}>
        {describeHistory(result)} Duración: {formatNumber(Math.round(result.elapsedMs / 1000))} s.
      </p>
      <AvanceResultTables result={result} />
      <RejectedRowsPanel rows={result.rejectedRows} totalRejected={result.rejectedTotal} />
      <div className={shared.actions}>
        {result.dryRun && (
          <Button type="button" variant={ButtonVariant.SECONDARY} onClick={flow.backToReview}>
            <ArrowLeft size={15} />
            Volver a la revisión
          </Button>
        )}
        <Button type="button" onClick={flow.restart}>
          <RotateCcw size={15} />
          Nueva carga
        </Button>
      </div>
    </div>
  </AvanceStepCard>
);
