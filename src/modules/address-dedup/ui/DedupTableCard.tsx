"use client";

import React from "react";
import shared from "./DedupShared.module.css";
import styles from "./DedupTableCard.module.css";

interface DedupTableCardProps {
  title: string;
  caption: string;
  tableClassName: string;
  dense?: boolean;
  children: React.ReactNode;
}

export const DedupTableCard: React.FC<DedupTableCardProps> = ({
  title,
  caption,
  tableClassName,
  dense = false,
  children,
}) => (
  <section className={`glass-panel ${styles.panel}`}>
    <h3 className={styles.title}>{title}</h3>
    <div className={styles.scroller}>
      <table className={`${styles.table} ${dense ? styles.dense : ""} ${tableClassName}`}>
        <caption className={shared.visuallyHidden}>{caption}</caption>
        {children}
      </table>
    </div>
  </section>
);
