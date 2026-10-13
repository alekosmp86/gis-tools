"use client";

import React from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import type { JobStatus } from "../job/types.ts";
import type { ShpJobRef } from "../domain/shpFlowState";
import { ShpFileSummary } from "./ShpFileSummary";
import { ShpGateTable } from "./ShpGateTable";
import { ShpLogTail } from "./ShpLogTail";
import { ShpMetricsTable } from "./ShpMetricsTable";
import { ShpResultAlerts } from "./ShpResultAlerts";
import { ShpRunStats } from "./ShpRunStats";
import { ShpStepCard } from "./ShpStepCard";
import type { ShpFlow } from "./useShpFlow";
import shared from "./ShpShared.module.css";

interface ShpResultStepProps {
  flow: ShpFlow;
  job: ShpJobRef;
  status: JobStatus;
}

export const ShpResultStep: React.FC<ShpResultStepProps> = ({ flow, job, status }) => (
  <ShpStepCard title="Resultado de la carga">
    <div className={shared.stack}>
      <ShpFileSummary fileName={job.fileName} sizeBytes={job.sizeBytes} target={job.target} />
      <ShpResultAlerts status={status} />
      <ShpRunStats status={status} />
      {status.gates && <ShpGateTable gates={status.gates} />}
      {status.testReport && <ShpMetricsTable report={status.testReport} />}
      {flow.state.error && <AlertMessage type={AlertType.ERROR} text={flow.state.error} />}
      <ShpLogTail jobId={job.jobId} tail={flow.state.logTail} />
      <div className={shared.actions}>
        <Button type="button" variant={ButtonVariant.SECONDARY} onClick={flow.discard}>
          <Trash2 size={15} />
          Descartar registro
        </Button>
        <Button type="button" onClick={flow.restart}>
          <RotateCcw size={15} />
          Nueva carga
        </Button>
      </div>
    </div>
  </ShpStepCard>
);
