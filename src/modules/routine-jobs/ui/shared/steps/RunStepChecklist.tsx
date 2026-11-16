"use client";

import React from "react";
import { Check, Circle, CircleX, Loader2, TriangleAlert } from "lucide-react";
import { buildStepChecklist, ChecklistStatus, resolvePlannedLabels, type ChecklistRow, type RunPlan } from "../stepChecklist";
import type { RunPhase } from "../jobRunStore";
import styles from "./WizardSteps.module.css";

const CHECKLIST_LABEL = "Pasos de la carga";

type IconComponent = React.ComponentType<{ className?: string }>;

const STATUS_ICON: Record<ChecklistStatus, IconComponent> = {
  [ChecklistStatus.DONE]: Check,
  [ChecklistStatus.CURRENT]: Loader2,
  [ChecklistStatus.PENDING]: Circle,
  [ChecklistStatus.FAILED]: CircleX,
  [ChecklistStatus.UNKNOWN]: TriangleAlert,
};

const ICON_CLASS: Record<ChecklistStatus, string> = {
  [ChecklistStatus.DONE]: styles.iconDone,
  [ChecklistStatus.CURRENT]: `${styles.iconCurrent} ${styles.spin}`,
  [ChecklistStatus.PENDING]: styles.iconPending,
  [ChecklistStatus.FAILED]: styles.iconFailed,
  [ChecklistStatus.UNKNOWN]: styles.iconUnknown,
};

const ITEM_CLASS: Record<ChecklistStatus, string> = {
  [ChecklistStatus.DONE]: styles.checkItem,
  [ChecklistStatus.CURRENT]: `${styles.checkItem} ${styles.checkItemCurrent}`,
  [ChecklistStatus.PENDING]: `${styles.checkItem} ${styles.checkItemPending}`,
  [ChecklistStatus.FAILED]: `${styles.checkItem} ${styles.checkItemCurrent}`,
  [ChecklistStatus.UNKNOWN]: `${styles.checkItem} ${styles.checkItemCurrent}`,
};

export interface RunStepChecklistProps {
  plan?: RunPlan;
  steps?: readonly string[];
  currentLabel: string | null;
  phase: RunPhase;
}

function ChecklistItem({ row }: { row: ChecklistRow }) {
  const Icon = STATUS_ICON[row.status];
  return (
    <li className={ITEM_CLASS[row.status]}>
      <Icon className={`${styles.checkIcon} ${ICON_CLASS[row.status]}`} aria-hidden="true" />
      <span>{row.label}</span>
    </li>
  );
}

export const RunStepChecklist: React.FC<RunStepChecklistProps> = ({ plan, steps, currentLabel, phase }) => {
  const rows = buildStepChecklist({
    plannedLabels: resolvePlannedLabels({ steps, plan }),
    currentLabel,
    phase,
  });
  if (rows.length === 0) return null;
  return (
    <ol className={styles.checklist} aria-label={CHECKLIST_LABEL}>
      {rows.map((row) => (
        <ChecklistItem key={row.label} row={row} />
      ))}
    </ol>
  );
};
