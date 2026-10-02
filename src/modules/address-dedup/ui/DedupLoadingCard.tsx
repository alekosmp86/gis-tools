"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import { LOADING_MESSAGE } from "../data/dedupLabels";
import styles from "./DedupLoadingCard.module.css";

export const DedupLoadingCard: React.FC = () => (
  <section className={`glass-panel ${styles.card}`} role="status" aria-live="polite">
    <Loader2 size={28} className={styles.spinner} />
    <h3 className={styles.title}>Analizando duplicados...</h3>
    <div className={styles.track}>
      <div className={styles.indicator} />
    </div>
    <p className={styles.message}>{LOADING_MESSAGE}</p>
  </section>
);
