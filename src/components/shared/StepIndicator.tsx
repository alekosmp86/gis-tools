import React from "react";
import { Check } from "lucide-react";
import type { WizardStepDef } from "@/types/ui";
import styles from "./StepIndicator.module.css";

export interface StepIndicatorProps {
  currentStep: number;
  steps?: WizardStepDef[];
  onStepClick?: (stepId: number) => void;
}

export const StepIndicator: React.FC<StepIndicatorProps> = ({
  currentStep,
  steps = [],
  onStepClick,
}) => {
  return (
    <div className={styles.stepperContainer}>
      {steps.map((step, index) => {
        const IconComponent = step.icon;
        const isCompleted = currentStep > step.id;
        const isActive = currentStep === step.id;
        const isClickable = Boolean(onStepClick && step.id < currentStep);
        const isNotLast = index < steps.length - 1;

        const handleKeyDown = (event: React.KeyboardEvent) => {
          if (isClickable && onStepClick && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onStepClick(step.id);
          }
        };

        return (
          <React.Fragment key={step.id}>
            <div className={styles.stepWrapper}>
              <div
                role={isClickable ? "button" : undefined}
                tabIndex={isClickable ? 0 : undefined}
                onClick={() => isClickable && onStepClick && onStepClick(step.id)}
                onKeyDown={handleKeyDown}
                className={`${styles.stepItem} ${
                  isCompleted ? styles.completed : ""
                } ${isActive ? styles.active : ""} ${
                  isClickable ? styles.clickable : ""
                }`}
              >
                <div className={styles.iconCircle}>
                  {isCompleted ? <Check size={18} /> : <IconComponent size={18} />}
                </div>

                <div className={styles.stepInfo}>
                  <span className={styles.stepNumber}>PASO {step.id}</span>
                  <span className={styles.stepTitle}>{step.title}</span>
                  {step.subtitle && (
                    <span className={styles.stepSubtitle}>{step.subtitle}</span>
                  )}
                </div>
              </div>

              {/* Connecting line between horizontal wizard steps */}
              {isNotLast && (
                <div
                  className={`${styles.stepConnector} ${
                    isCompleted ? styles.connectorCompleted : ""
                  }`}
                />
              )}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};
