"use client";

import React from "react";
import { Check } from "lucide-react";
import { StepperTone, type StepperEntry } from "./stepperEntries";
import styles from "./WorkflowStepper.module.css";

interface WorkflowStepperProps {
  entries: ReadonlyArray<StepperEntry>;
}

const TONE_CLASS: Readonly<Record<StepperTone, string>> = {
  [StepperTone.IDLE]: "",
  [StepperTone.DONE]: styles.done,
  [StepperTone.SKIPPED]: styles.skipped,
  [StepperTone.BUSY]: styles.busy,
};

interface WorkflowStepProps {
  entry: StepperEntry;
  position: number;
}

const WorkflowStep: React.FC<WorkflowStepProps> = ({ entry, position }) => {
  const { Icon } = entry;
  const className = `${styles.step} ${TONE_CLASS[entry.tone]} ${entry.isActive ? styles.active : ""}`;
  const content = (
    <>
      <span className={styles.iconCircle}>
        {entry.tone === StepperTone.DONE ? <Check size={18} /> : <Icon size={18} />}
      </span>
      <span className={styles.info}>
        <span className={styles.number}>Paso {position}</span>
        <span className={styles.title}>{entry.title}</span>
        <span className={styles.caption}>{entry.caption}</span>
      </span>
    </>
  );

  return (
    <li className={styles.item}>
      {entry.select ? (
        <button type="button" className={`${className} ${styles.clickable}`} onClick={entry.select}
          aria-current={entry.isActive ? "step" : undefined}
        >
          {content}
        </button>
      ) : (
        <div className={className} aria-current={entry.isActive ? "step" : undefined}>
          {content}
        </div>
      )}
    </li>
  );
};

/** Shows every step of the workflow with its status; opened steps are buttons. */
export const WorkflowStepper: React.FC<WorkflowStepperProps> = ({ entries }) => (
  <nav aria-label="Pasos de la carga">
    <ol className={styles.container}>
      {entries.map((entry, index) => (
        <WorkflowStep key={entry.key} entry={entry} position={index + 1} />
      ))}
    </ol>
  </nav>
);
