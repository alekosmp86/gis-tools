"use client";

import React from "react";
import { SelectField } from "@/ui-kit/components/ui/SelectField";
import { EJES_MANUAL_SPLIT_TEXT } from "../ejesAcceptTexts";
import { MANUAL_RADIUS_OPTIONS_M } from "./manualSplitView";
import styles from "./manualSplit.module.css";

const RADIUS_OPTIONS = MANUAL_RADIUS_OPTIONS_M.map((meters) => ({ value: String(meters), label: `${meters} m` }));

export interface ManualSplitControlsProps {
  radius: number;
  onRadius: (radius: number) => void;
  otherStreets: boolean;
  onOtherStreets: (otherStreets: boolean) => void;
}

/** The search of the candidates: the radius around the old section and whether the other streets count too. */
export function ManualSplitControls({ radius, onRadius, otherStreets, onOtherStreets }: ManualSplitControlsProps) {
  return (
    <div className={styles.controls}>
      <SelectField
        label={EJES_MANUAL_SPLIT_TEXT.RADIUS}
        value={String(radius)}
        options={RADIUS_OPTIONS}
        onChange={(value) => onRadius(Number(value))}
      />
      <label className={styles.switch}>
        <input type="checkbox" checked={otherStreets} onChange={(event) => onOtherStreets(event.currentTarget.checked)} />
        <span>{EJES_MANUAL_SPLIT_TEXT.OTHER_STREETS}</span>
      </label>
    </div>
  );
}
