"use client";

import React from "react";
import { StepIndicator } from "@/ui-kit/components/StepIndicator";
import { FlowPhase } from "../domain/loadFlow";
import { IndicatorsBusyCard } from "./IndicatorsBusyCard";
import { IndicatorsConnectionStep } from "./IndicatorsConnectionStep";
import { IndicatorsFilesStep } from "./IndicatorsFilesStep";
import { IndicatorsResultStep } from "./IndicatorsResultStep";
import { IndicatorsReviewStep } from "./IndicatorsReviewStep";
import { INDICATORS_STEPS } from "./indicatorsSteps";
import { useIndicatorsFlow, type IndicatorsFlow } from "./useIndicatorsFlow";

function renderPhase(flow: IndicatorsFlow): React.ReactNode {
  const { phase, plan, result } = flow.state;
  switch (phase) {
    case FlowPhase.CONNECTION:
      return <IndicatorsConnectionStep flow={flow} />;
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

/** The "Indicadores LTE" section: connection, files, review of the plan, and result with reports. */
export const IndicatorsPanel: React.FC = () => {
  const flow = useIndicatorsFlow();

  return (
    <>
      <StepIndicator currentStep={flow.step} steps={[...INDICATORS_STEPS]} />
      {renderPhase(flow)}
    </>
  );
};
