"use client";

import React from "react";
import { AlertTriangle, CheckCircle2, XCircle, type LucideIcon } from "lucide-react";
import { buildPlanChecks, CheckLevel } from "../domain/shpPlanChecks";
import type { ShpPlan } from "../types";
import styles from "./ShpPlanChecks.module.css";

interface ShpPlanChecksProps {
  plan: ShpPlan;
}

const LEVEL_ICONS: Readonly<Record<CheckLevel, LucideIcon>> = {
  [CheckLevel.OK]: CheckCircle2,
  [CheckLevel.WARNING]: AlertTriangle,
  [CheckLevel.ERROR]: XCircle,
};

const LEVEL_CLASSES: Readonly<Record<CheckLevel, string>> = {
  [CheckLevel.OK]: styles.ok,
  [CheckLevel.WARNING]: styles.warning,
  [CheckLevel.ERROR]: styles.error,
};

export const ShpPlanChecks: React.FC<ShpPlanChecksProps> = ({ plan }) => (
  <ul className={styles.list}>
    {buildPlanChecks(plan).map((check) => {
      const Icon = LEVEL_ICONS[check.level];
      return (
        <li key={check.key} className={styles.item}>
          <Icon size={18} className={`${styles.icon} ${LEVEL_CLASSES[check.level]}`} />
          <span className={styles.text}>
            <span className={styles.label}>{check.label}</span>
            <span className={styles.detail}>{check.detail}</span>
          </span>
        </li>
      );
    })}
  </ul>
);
