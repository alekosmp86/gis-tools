"use client";

import React from "react";
import { CoverageConnectionForm } from "../../shared/ui/CoverageConnectionForm";
import type { IndicatorsFlow } from "./useIndicatorsFlow";
import { IndicatorsStepCard } from "./IndicatorsStepCard";

interface IndicatorsConnectionStepProps {
  flow: IndicatorsFlow;
}

export const IndicatorsConnectionStep: React.FC<IndicatorsConnectionStepProps> = ({ flow }) => (
  <IndicatorsStepCard title="1. Conexión a la base de datos">
    <CoverageConnectionForm
      connection={flow.state.connection}
      canSubmit={flow.canContinue}
      onFieldChange={flow.setConnectionField}
      onProfileLoaded={flow.applyProfile}
      onSubmit={flow.continueToFiles}
    />
  </IndicatorsStepCard>
);
