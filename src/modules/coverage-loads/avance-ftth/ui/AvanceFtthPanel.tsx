"use client";

import React from "react";
import type { StagePanelProps } from "../../shared/domain/stageContract";
import { FlowPhase } from "../domain/loadFlow";
import { AvanceBusyCard } from "./AvanceBusyCard";
import { AvanceFilesStep } from "./AvanceFilesStep";
import { AvanceResultStep } from "./AvanceResultStep";
import { AvanceReviewStep } from "./AvanceReviewStep";
import { useAvanceFtthFlow, type AvanceFtthFlow } from "./useAvanceFtthFlow";

function renderPhase(flow: AvanceFtthFlow): React.ReactNode {
  const { phase, plan, result, mode } = flow.state;
  switch (phase) {
    case FlowPhase.FILES:
      return <AvanceFilesStep flow={flow} />;
    case FlowPhase.PLANNING:
    case FlowPhase.RUNNING:
      return <AvanceBusyCard mode={mode} />;
    case FlowPhase.REVIEW:
      return plan ? <AvanceReviewStep flow={flow} plan={plan} /> : null;
    case FlowPhase.DONE:
      return result ? <AvanceResultStep flow={flow} result={result} /> : null;
  }
}

/** The "Avance FTTH" stage: files, review of the plan, and the run (dry or real) with its result. */
export const AvanceFtthPanel: React.FC<StagePanelProps> = ({ connection, connectionRevision, onStatusChange }) => {
  const flow = useAvanceFtthFlow(connection, connectionRevision, onStatusChange);

  return <>{renderPhase(flow)}</>;
};
