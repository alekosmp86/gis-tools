"use client";

import React, { useId, useRef } from "react";
import { X } from "lucide-react";
import { useBackdropDismiss } from "@/ui-kit/hooks/useBackdropDismiss";
import { useOpenModalDialog } from "@/ui-kit/hooks/useOpenModalDialog";
import styles from "./Modal.module.css";

const ICON_SIZE = 18;
const CLOSE_LABEL = "Cerrar";

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * A centred modal dialog. Escape and the close event report through onClose, as does a click on the backdrop.
 * Mount it only while open: the modal opens on mount and closes on unmount.
 */
export function Modal({ title, onClose, children }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useOpenModalDialog(dialogRef);
  useBackdropDismiss(dialogRef, onClose);

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} aria-modal="true" onClose={onClose}>
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label={CLOSE_LABEL} title={CLOSE_LABEL}>
          <X size={ICON_SIZE} />
        </button>
      </header>
      <div className={styles.body}>{children}</div>
    </dialog>
  );
}
