"use client";

import React from "react";
import { Ban } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { ProgressBar } from "@/ui-kit/components/ProgressBar";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import { JOB_STATE } from "../job/types.ts";
import { currentPhaseLabel, overallPercent } from "../domain/shpJobView";
import type { ShpJobRef } from "../domain/shpFlowState";
import { ShpFileSummary } from "./ShpFileSummary";
import { ShpLogTail } from "./ShpLogTail";
import { ShpNotifyButton } from "./ShpNotifyButton";
import { ShpPhaseDetail } from "./ShpPhaseDetail";
import { ShpRunStats } from "./ShpRunStats";
import { ShpStageList } from "./ShpStageList";
import { ShpStepCard } from "./ShpStepCard";
import type { ShpFlow } from "./useShpFlow";
import shared from "./ShpShared.module.css";

interface ShpRunStepProps {
  flow: ShpFlow;
  job: ShpJobRef;
}

const STALE_MESSAGE = "La carga parece detenida: el servidor no recibe señales de ella. Se cerrará como fallida en breve.";
const STARTING_TITLE = "Iniciando la carga";

export const ShpRunStep: React.FC<ShpRunStepProps> = ({ flow, job }) => {
  const { status, stale, logTail, error } = flow.state;
  const isCancelling = status?.state === JOB_STATE.CANCELLING || status?.cancelRequested === true;

  return (
    <ShpStepCard title={status === null ? STARTING_TITLE : `Carga en curso: public.${job.target.table}`}>
      <div className={shared.stack}>
        <ShpFileSummary fileName={job.fileName} sizeBytes={job.sizeBytes} target={job.target} />
        <ProgressBar
          phase={currentPhaseLabel(status)}
          current={status?.progress.rowsCopied ?? 0}
          total={0}
          pct={overallPercent(status)}
        />
        {status && <ShpPhaseDetail status={status} />}
        {status && <ShpRunStats status={status} />}
        {status && <ShpStageList stages={status.stages} />}
        {stale && <AlertMessage type={AlertType.WARNING} text={STALE_MESSAGE} />}
        {error && <AlertMessage type={AlertType.ERROR} text={error} />}
        <ShpLogTail jobId={job.jobId} tail={logTail} />
        <div className={shared.actions}>
          <ShpNotifyButton />
          <Button type="button" variant={ButtonVariant.SECONDARY} isDisabled={isCancelling || status === null} onClick={flow.cancelRun}>
            <Ban size={15} />
            {isCancelling ? "Cancelando..." : "Cancelar carga"}
          </Button>
        </div>
      </div>
    </ShpStepCard>
  );
};
