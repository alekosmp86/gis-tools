"use client";

import React from "react";
import styles from "./ActualizarPadronReport.module.css";

export function CollapsibleSection({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className={styles.details}>
      <summary className={styles.summary}>{summary}</summary>
      <div className={styles.detailsBody}>{children}</div>
    </details>
  );
}
