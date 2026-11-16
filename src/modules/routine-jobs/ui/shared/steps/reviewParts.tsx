"use client";

import React from "react";
import { DatabaseZap, Search } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import styles from "./WizardSteps.module.css";

export const PASSWORD_LABEL = "Contraseña de la base de datos";

const ICON_SIZE = 15;

export interface ReviewRunActionsProps {
  dryRunHint: string;
  runHint: string;
  busyNote: string;
  runLabel: string;
  busy: boolean;
  runBlockedReason: string | null;
  canDryRun: boolean;
  canRun: boolean;
  onDryRun: () => void;
  onRun: () => void;
}

/** Hints, busy and blocked notes and the dry-run / real-run buttons shared by every review step. */
export const ReviewRunActions: React.FC<ReviewRunActionsProps> = ({
  dryRunHint,
  runHint,
  busyNote,
  runLabel,
  busy,
  runBlockedReason,
  canDryRun,
  canRun,
  onDryRun,
  onRun,
}) => {
  const blocked = busy || runBlockedReason !== null;
  return (
    <>
      <p className={styles.hint}>{dryRunHint}</p>
      <p className={styles.hint}>{runHint}</p>

      {busy && <AlertMessage type={AlertType.WARNING} text={busyNote} />}
      {runBlockedReason !== null && <AlertMessage type={AlertType.WARNING} text={runBlockedReason} />}
      <div className={styles.actions}>
        <Button variant={ButtonVariant.SECONDARY} isDisabled={blocked || !canDryRun} onClick={onDryRun}>
          <Search size={ICON_SIZE} />
          <span>Analizar sin cargar</span>
        </Button>
        <Button isDisabled={blocked || !canRun} onClick={onRun}>
          <DatabaseZap size={ICON_SIZE} />
          <span>{runLabel}</span>
        </Button>
      </div>
    </>
  );
};
