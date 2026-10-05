"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import { REMOVAL_LABELS } from "../data/removalLabels";
import { REMOVAL_PENDING_MESSAGE } from "../removalConstants";
import styles from "./DedupRemovalReminder.module.css";

/** Always rendered beside any removal outcome: the Solr and view refresh steps are never done here. */
export const DedupRemovalReminder: React.FC = () => (
  <aside className={styles.reminder} aria-label={REMOVAL_LABELS.REMINDER_TITLE}>
    <AlertTriangle size={18} className={styles.icon} />
    <div className={styles.text}>
      <strong>{REMOVAL_LABELS.REMINDER_TITLE}</strong>
      <p>{REMOVAL_LABELS.REMINDER_BODY}</p>
      <p>{REMOVAL_PENDING_MESSAGE}</p>
    </div>
  </aside>
);
