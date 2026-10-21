"use client";

import React from "react";
import { X } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { LayerLoadResult } from "../types";
import { SigraResultTable } from "./SigraResultTable";
import styles from "./SigraResultModal.module.css";

interface SigraResultModalProps {
  results: ReadonlyArray<LayerLoadResult>;
  dryRun: boolean;
  onClose: () => void;
}

/** Opens as a native modal dialog as soon as it mounts; Escape and the close button both end in `onClose`. */
function openModal(dialog: HTMLDialogElement | null): void {
  if (dialog && !dialog.open) dialog.showModal();
}

export const SigraResultModal: React.FC<SigraResultModalProps> = ({ results, dryRun, onClose }) => (
  <dialog className={styles.dialog} ref={openModal} onClose={onClose} aria-label="Resultado de la corrida">
    <div className={styles.content}>
      <SigraResultTable results={results} dryRun={dryRun} />
      <div className={styles.footer}>
        <Button type="button" onClick={onClose}>
          <X size={15} />
          Cerrar
        </Button>
      </div>
    </div>
  </dialog>
);
