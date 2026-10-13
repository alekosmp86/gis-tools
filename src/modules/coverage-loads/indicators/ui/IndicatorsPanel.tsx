"use client";

import React from "react";
import type { StagePanelProps } from "../../shared/domain/stageContract";
import { FlowPhase } from "../domain/loadFlow";
import { IndicatorsBusyCard } from "./IndicatorsBusyCard";
import { IndicatorsFilesStep } from "./IndicatorsFilesStep";
import { IndicatorsResultStep } from "./IndicatorsResultStep";
import { IndicatorsReviewStep } from "./IndicatorsReviewStep";
import { useIndicatorsFlow, type IndicatorsFlow } from "./useIndicatorsFlow";

function renderPhase(flow: IndicatorsFlow): React.ReactNode {
  const { phase, plan, result } = flow.state;
  switch (phase) {
    case FlowPhase.FILES:
      return <IndicatorsFilesStep flow={flow} />;
    case FlowPhase.PLANNING:
      return <IndicatorsBusyCard />;
    case FlowPhase.REVIEW:
    case FlowPhase.LOADING:
      return plan ? <IndicatorsReviewStep flow={flow} plan={plan} /> : null;
    case FlowPhase.DONE:
      return result ? <IndicatorsResultStep flow={flow} result={result} /> : null;
  }
}

/** The "Indicadores LTE" stage: files, review of the plan, and the load result. */
export const IndicatorsPanel: React.FC<StagePanelProps> = ({ connection, connectionRevision, onStatusChange }) => {
  const flow = useIndicatorsFlow(connection, connectionRevision, onStatusChange);

  return <>{renderPhase(flow)}</>;
};
