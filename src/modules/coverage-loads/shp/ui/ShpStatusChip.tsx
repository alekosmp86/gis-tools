"use client";

import React from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { chipDetail, chipLabel } from "../domain/shpAttention";
import { SHP_PAGE_ROUTE } from "./shpUiConstants";
import { useTrackedShpJob } from "./useTrackedShpJob";
import shared from "./ShpShared.module.css";
import styles from "./ShpStatusChip.module.css";

/** The app-wide chip (slot APP_STATUS): visible on every page while an SHP job runs, links to its page. */
export const ShpStatusChip: React.FC = () => {
  const status = useTrackedShpJob();

  if (status === null) return null;

  return (
    <Link href={SHP_PAGE_ROUTE} className={`glass-panel ${styles.chip}`} role="status" aria-live="polite">
      <Loader2 size={16} className={`${styles.icon} ${shared.spin}`} />
      <span className={styles.text}>
        <span className={styles.label}>{chipLabel(status)}</span>
        <span className={styles.detail}>{chipDetail(status)}</span>
      </span>
    </Link>
  );
};
