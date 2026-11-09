"use client";

import React from "react";
import { Database } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { FormField } from "@/ui-kit/components/ui/FormField";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import type { ActualizarWizardConfirmation } from "../actualizarPadronWizardState";
import { PASSWORD_LABEL } from "./reviewParts";
import styles from "./ActualizarPersistPanel.module.css";

const TITLE = "Persistir cambios revisados";
const BUTTON_LABEL = "Persistir cambios revisados";
const ICON_SIZE = 15;

export interface ActualizarPersistPanelProps {
  summary: string;
  confirmation: ActualizarWizardConfirmation;
  blockedReason: string | null;
  notice: string | null;
  onConfirmationChange: (patch: Partial<ActualizarWizardConfirmation>) => void;
  onPersist: () => void;
}

export type ActualizarPersistState = Omit<ActualizarPersistPanelProps, "summary">;

export const ActualizarPersistPanel: React.FC<ActualizarPersistPanelProps> = ({
  summary,
  confirmation,
  blockedReason,
  notice,
  onConfirmationChange,
  onPersist,
}) => (
  <section className={styles.panel}>
    <h3 className={styles.title}>{TITLE}</h3>
    <p className={styles.summary}>{summary}</p>
    <div className={styles.fields}>
      <FormField
        label={PASSWORD_LABEL}
        type="password"
        value={confirmation.password}
        onChange={(password) => onConfirmationChange({ password })}
      />
    </div>
    {blockedReason !== null && <AlertMessage type={AlertType.WARNING} text={blockedReason} />}
    <div>
      <Button variant={ButtonVariant.PRIMARY} isDisabled={blockedReason !== null} onClick={onPersist}>
        <Database size={ICON_SIZE} />
        <span>{BUTTON_LABEL}</span>
      </Button>
    </div>
    {notice !== null && <p className={styles.notice}>{notice}</p>}
  </section>
);
