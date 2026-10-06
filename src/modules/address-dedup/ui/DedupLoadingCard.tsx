"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import { LOADING_MESSAGE } from "../data/dedupLabels";
import { useModalDialog } from "./useModalDialog";
import styles from "./DedupLoadingCard.module.css";

interface DedupLoadingCardProps {
  isOpen: boolean;
}

export const DedupLoadingCard: React.FC<DedupLoadingCardProps> = ({ isOpen }) => {
  const dialogRef = useModalDialog(isOpen);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="dedup-loading-title"
      onCancel={(event) => event.preventDefault()}
    >
      {isOpen && (
        <div className={styles.content} role="status" aria-live="polite">
          <Loader2 size={28} className={styles.spinner} />
          <h3 id="dedup-loading-title" className={styles.title}>
            Analizando duplicados...
          </h3>
          <div className={styles.track}>
            <div className={styles.indicator} />
          </div>
          <p className={styles.message}>{LOADING_MESSAGE}</p>
        </div>
      )}
    </dialog>
  );
};
