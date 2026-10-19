import { useRef, useState } from "react";
import type { ColumnMappingConfig, SuidMappingStepRef, SyncParametersStepRef } from "@/core/types/comparison";

export function useWizardMappingState(stepOffset: number = 0) {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [mappingConfig, setMappingConfig] = useState<ColumnMappingConfig | null>(null);
  const [isMappingReady, setIsMappingReady] = useState(true);

  const suidMappingRef = useRef<SuidMappingStepRef | null>(null);
  const syncParametersRef = useRef<SyncParametersStepRef | null>(null);

  const handleMappingSuccess = (config: ColumnMappingConfig) => {
    setMappingConfig((previous) => ({
      ...previous,
      ...config,
    }));
    setCurrentStep(4 + stepOffset);
  };

  const handleSyncParametersSuccess = (finalConfig: ColumnMappingConfig) => {
    setMappingConfig(finalConfig);
    setCurrentStep(5 + stepOffset);
  };

  const handleStepClick = (stepId: number) => {
    if (stepId < currentStep) {
      setCurrentStep(stepId);
    }
  };

  return {
    currentStep,
    setCurrentStep,
    mappingConfig,
    isMappingReady,
    setIsMappingReady,
    suidMappingRef,
    syncParametersRef,
    handleMappingSuccess,
    handleSyncParametersSuccess,
    handleStepClick,
  };
}
