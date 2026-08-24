import React from "react";
import { Check } from "lucide-react";
import { WIZARD_STEPS } from "@/data/wizardStepsData";
import type { StepIndicatorProps } from "@/types/gis";
import styles from "./StepIndicator.module.css";

export const StepIndicator: React.FC<StepIndicatorProps> = ({
  currentStep,
  onStepClick,
}) => {
  return (
    <div className={styles.stepperContainer}>
      {WIZARD_STEPS.map((step, index) => {
        const IconComponent = step.icon;
        const isCompleted = currentStep > step.id;
        const isActive = currentStep === step.id;
        const isClickable = Boolean(onStepClick && step.id < currentStep);
        const isNotLast = index < WIZARD_STEPS.length - 1;

        const handleKeyDown = (e: React.KeyboardEvent) => {
          if (isClickable && onStepClick && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
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
                  <span className={styles.stepSubtitle}>{step.subtitle}</span>
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
