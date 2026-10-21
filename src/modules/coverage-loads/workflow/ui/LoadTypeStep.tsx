"use client";

import React from "react";
import { Cable, Signal, type LucideIcon } from "lucide-react";
import { LOAD_TYPE_LABELS, LoadType } from "../domain/loadType";
import { WorkflowStepCard } from "./WorkflowStepCard";
import styles from "./LoadTypeStep.module.css";

interface LoadTypeStepProps {
  selected: LoadType | null;
  onSelect: (loadType: LoadType) => void;
}

const LOAD_TYPE_ICONS: Readonly<Record<LoadType, LucideIcon>> = {
  [LoadType.COVERAGE]: Signal,
  [LoadType.FTTH]: Cable,
};

const LOAD_TYPE_ORDER: ReadonlyArray<LoadType> = [LoadType.COVERAGE, LoadType.FTTH];

/** The first choice of the workflow: what is going to be loaded. */
export const LoadTypeStep: React.FC<LoadTypeStepProps> = ({ selected, onSelect }) => (
  <WorkflowStepCard title="Tipo de carga">
    <div className={styles.choices} role="radiogroup" aria-label="Tipo de carga">
      {LOAD_TYPE_ORDER.map((loadType) => {
        const Icon = LOAD_TYPE_ICONS[loadType];
        return (
          <label
            key={loadType}
            className={loadType === selected ? `${styles.choice} ${styles.selected}` : styles.choice}
          >
            <input
              type="radio"
              name="load-type"
              className={styles.input}
              value={loadType}
              checked={loadType === selected}
              onChange={() => onSelect(loadType)}
              onClick={() => onSelect(loadType)}
            />
            <Icon size={22} aria-hidden="true" />
            <span className={styles.label}>{LOAD_TYPE_LABELS[loadType]}</span>
          </label>
        );
      })}
    </div>
  </WorkflowStepCard>
);
