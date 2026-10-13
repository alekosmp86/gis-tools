"use client";

import React from "react";
import { CheckCircle2, Circle, Loader2, MinusCircle, XCircle, type LucideIcon } from "lucide-react";
import { STAGE_STATE } from "../job/types.ts";
import type { StageEntry, StageState } from "../job/types.ts";
import { stageLabel, stageStateLabel } from "../domain/shpJobView";
import shared from "./ShpShared.module.css";
import styles from "./ShpStageList.module.css";

interface ShpStageListProps {
  stages: ReadonlyArray<StageEntry>;
}

const STATE_ICONS: Readonly<Record<StageState, LucideIcon>> = {
  [STAGE_STATE.PENDING]: Circle,
  [STAGE_STATE.RUNNING]: Loader2,
  [STAGE_STATE.DONE]: CheckCircle2,
  [STAGE_STATE.SKIPPED]: MinusCircle,
  [STAGE_STATE.FAILED]: XCircle,
};

const STATE_CLASSES: Readonly<Record<StageState, string>> = {
  [STAGE_STATE.PENDING]: "",
  [STAGE_STATE.RUNNING]: `${styles.running} ${shared.spin}`,
  [STAGE_STATE.DONE]: styles.done,
  [STAGE_STATE.SKIPPED]: "",
  [STAGE_STATE.FAILED]: styles.failed,
};

export const ShpStageList: React.FC<ShpStageListProps> = ({ stages }) => (
  <ol className={styles.list}>
    {stages.map((stage) => {
      const Icon = STATE_ICONS[stage.state];
      return (
        <li key={stage.id} className={styles.item}>
          <Icon size={16} className={`${styles.icon} ${STATE_CLASSES[stage.state]}`} />
          <span>{stageLabel(stage.id)}</span>
          <span className={styles.state}>{stageStateLabel(stage.state)}</span>
        </li>
      );
    })}
  </ol>
);
