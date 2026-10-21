"use client";

import React from "react";
import { Check, TriangleAlert, X } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import shared from "./SigraShared.module.css";
import styles from "./SigraReplaceConfirmation.module.css";

interface SigraReplaceConfirmationProps {
  text: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ESCAPE_KEY = "Escape";

/** The first button of the box is Cancel, the safe choice: it gets the focus when the box opens. */
function focusCancel(element: HTMLDivElement | null): void {
  element?.querySelector("button")?.focus();
}

function closeOnEscape(event: React.KeyboardEvent, onCancel: () => void): void {
  if (event.key === ESCAPE_KEY) onCancel();
}

export const SigraReplaceConfirmation: React.FC<SigraReplaceConfirmationProps> = ({ text, onConfirm, onCancel }) => (
  <div className={styles.box} role="alert" ref={focusCancel} onKeyDown={(event) => closeOnEscape(event, onCancel)}>
    <p className={styles.text}>
      <TriangleAlert size={18} className={styles.icon} />
      {text}
    </p>
    <div className={shared.actions}>
      <Button type="button" variant={ButtonVariant.SECONDARY} onClick={onCancel}>
        <X size={15} />
        Cancelar
      </Button>
      <Button type="button" onClick={onConfirm}>
        <Check size={15} />
        Confirmar y reemplazar
      </Button>
    </div>
  </div>
);
