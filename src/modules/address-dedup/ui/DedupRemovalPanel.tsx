"use client";

import React from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { Decision } from "../constants";
import { REMOVAL_LABELS } from "../data/removalLabels";
import { decisionTotal } from "../domain/summaryView";
import type { DedupRequestPayload, DedupSummary } from "../types";
import { DedupRemovalDialog } from "./DedupRemovalDialog";
import { useDedupRemoval } from "./useDedupRemoval";
import styles from "./DedupRemovalPanel.module.css";

interface DedupRemovalPanelProps {
  summary: DedupSummary;
  payload: DedupRequestPayload;
}

/** The only entry to the removal flow. It acts on the whole fresh REMOVE set, never on the current filter. */
export const DedupRemovalPanel: React.FC<DedupRemovalPanelProps> = ({ summary, payload }) => {
  const flow = useDedupRemoval(payload);
  const hasRemovals = decisionTotal(summary, Decision.REMOVE) > 0;

  return (
    <section className={`glass-panel ${styles.panel}`} aria-labelledby="dedup-removal-panel-title">
      <div className={styles.text}>
        <h3 id="dedup-removal-panel-title" className={styles.title}>
          {REMOVAL_LABELS.PANEL_TITLE}
        </h3>
        <p className={styles.description}>
          {hasRemovals ? REMOVAL_LABELS.PANEL_DESCRIPTION : REMOVAL_LABELS.NOTHING_TO_REMOVE}
        </p>
      </div>
      <Button type="button" className={styles.danger} isDisabled={!hasRemovals} onClick={flow.open}>
        <Trash2 size={15} />
        {REMOVAL_LABELS.OPEN_BUTTON}
      </Button>
      <DedupRemovalDialog flow={flow} />
    </section>
  );
};
