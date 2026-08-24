import React from "react";
import { Check } from "lucide-react";
import { WIZARD_STEPS } from "@/data/wizardStepsData";
import styles from "./StepIndicator.module.css";

export interface StepIndicatorProps {
  currentStep: number;
  onStepClick?: (stepId: number) => void;
}

export const StepIndicator: React.FC<StepIndicatorProps> = ({
  currentStep,
  onStepClick,
}) => {
  return (
    <div className={`glass-panel ${styles.container}`}>
      {WIZARD_STEPS.map((step, idx) => {
        const Icon = step.icon;
        const isCompleted = currentStep > step.id;
        const isActive = currentStep === step.id;

        return (
          <React.Fragment key={step.id}>
            <div
              className={`${styles.stepItem} ${
                isActive ? styles.active : isCompleted ? styles.completed : styles.disabled
              }`}
              onClick={() => isCompleted && onStepClick && onStepClick(step.id)}
            >
              <div className={styles.iconCircle}>
                {isCompleted ? <Check size={16} /> : <Icon size={18} />}
              </div>
              <div className={styles.stepInfo}>
                <div className={styles.stepTitle}>{step.title}</div>
                <div className={styles.stepSub}>{step.subtitle}</div>
              </div>
            </div>

            {idx < WIZARD_STEPS.length - 1 && <div className={styles.stepConnector} />}
          </React.Fragment>
        );
      })}
    </div>
  );
};
