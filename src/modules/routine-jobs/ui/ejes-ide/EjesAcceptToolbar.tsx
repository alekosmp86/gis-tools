"use client";

import React from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import styles from "./EjesAccept.module.css";
import { EJES_ACCEPT_TEXT, incompleteListTextOf } from "./ejesAcceptTexts";

const ICON_SIZE = 15;

export interface EjesAcceptToolbarProps {
  /** Rows the list holds, and the rows the analysis counted. */
  listed: number;
  total: number;
  canAcceptAll: boolean;
  canRejectAll: boolean;
  capped: boolean;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  /** Filters shown on the same row, before the bulk actions. */
  filters?: React.ReactNode;
  /** The "N aceptados de M" counter, shown after the bulk actions when given. */
  counterText?: string;
}

/** The filters, "Aceptar todos" and "Rechazar todos" for the rows of one list, with the notes on an incomplete list or the request limit. */
export const EjesAcceptToolbar: React.FC<EjesAcceptToolbarProps> = ({
  listed,
  total,
  canAcceptAll,
  canRejectAll,
  capped,
  onAcceptAll,
  onRejectAll,
  filters,
  counterText,
}) => (
  <>
    <div className={styles.toolbar}>
      {filters}
      <div className={styles.actions}>
        <Button variant={ButtonVariant.SECONDARY} onClick={onAcceptAll} disabled={!canAcceptAll}>
          <Check size={ICON_SIZE} />
          <span>{EJES_ACCEPT_TEXT.ACCEPT_ALL}</span>
        </Button>
        <Button variant={ButtonVariant.SECONDARY} onClick={onRejectAll} disabled={!canRejectAll}>
          <X size={ICON_SIZE} />
          <span>{EJES_ACCEPT_TEXT.REJECT_ALL}</span>
        </Button>
        {counterText !== undefined && <span className={styles.badge}>{counterText}</span>}
      </div>
    </div>
    {total > listed && <p className={styles.note}>{incompleteListTextOf(listed, total)}</p>}
    {capped && <p className={styles.note}>{EJES_ACCEPT_TEXT.CAP_NOTE}</p>}
  </>
);
