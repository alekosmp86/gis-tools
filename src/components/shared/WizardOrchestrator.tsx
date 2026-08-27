import React, { useRef, useEffect } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StepIndicator } from "@/components/shared/StepIndicator";
import type { WizardOrchestratorProps } from "@/types/ui";
import styles from "./WizardOrchestrator.module.css";

export const WizardOrchestrator: React.FC<WizardOrchestratorProps> = ({
  steps,
  currentStep,
  onStepClick,
  step1Title,
  step1Subtitle,
  fileStepTitle,
  fileStepSubtitle,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeStep = steps.find((s) => s.id === currentStep) || steps[0];
  const IconComponent = activeStep.icon;

  const defaultBackLabel = currentStep > 1 ? `Volver al Paso ${currentStep - 1}` : undefined;
  const defaultNextLabel = currentStep < steps.length ? `Continuar al Paso ${currentStep + 1}` : undefined;

  useEffect(() => {
    containerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [currentStep]);

  return (
    <div className={styles.orchestratorContainer} ref={containerRef}>
      {/* 4-Step Wizard Stepper Bar */}
      <StepIndicator
        currentStep={currentStep}
        onStepClick={onStepClick}
        step1Title={step1Title}
        step1Subtitle={step1Subtitle}
        fileStepTitle={fileStepTitle}
        fileStepSubtitle={fileStepSubtitle}
      />

      {/* Primary Enclosed Glass Card Container for Current Active Step */}
      <div className={styles.stepCard}>
        {/* Step Header Block */}
        <div className={styles.header}>
          <div className={styles.headerIcon}>
            <IconComponent size={24} />
          </div>
          <div className={styles.headerTitleRow}>
            <div className={styles.stepBadge}>
              <span>Paso {activeStep.id} de {steps.length}</span>
            </div>
            <h2 className={styles.title}>
              {activeStep.id}. {activeStep.title}
            </h2>
            <p className={styles.subtitle}>{activeStep.subtitle}</p>
          </div>
        </div>

        {/* Step Body Content */}
        <div key={`step-content-${activeStep.id}`} className={styles.content}>
          {activeStep.content}
        </div>

        {/* Orchestration Navigation Footer */}
        {!activeStep.hideFooter && (activeStep.onBack || activeStep.onNext) && (
          <div className={styles.footer}>
            <div>
              {activeStep.onBack && (
                <Button variant="secondary" onClick={activeStep.onBack}>
                  <ArrowLeft size={16} />
                  <span>{activeStep.backLabel || defaultBackLabel}</span>
                </Button>
              )}
            </div>

            <div className={styles.footerRight}>
              {activeStep.onNext && (
                <Button
                  variant="primary"
                  onClick={activeStep.onNext}
                  isDisabled={activeStep.canProceed === false}
                >
                  <span>{activeStep.nextLabel || defaultNextLabel}</span>
                  <ArrowRight size={16} />
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
