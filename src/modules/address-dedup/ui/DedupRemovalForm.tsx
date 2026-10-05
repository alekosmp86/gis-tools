"use client";

import React from "react";
import { FileText, Loader2, SearchCheck, User } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { FormField } from "@/ui-kit/components/ui/FormField";
import { AlertType } from "@/ui-kit/types/ui";
import { REMOVAL_LABELS } from "../data/removalLabels";
import { MOTIVO_MAX_LENGTH, RESPONSABLE_MAX_LENGTH } from "../removalConstants";
import styles from "./DedupRemovalForm.module.css";

interface DedupRemovalFormProps {
  responsable: string;
  motivo: string;
  isSimulating: boolean;
  canSimulate: boolean;
  errorText: string | null;
  onResponsableChange: (value: string) => void;
  onMotivoChange: (value: string) => void;
  onSimulate: () => void;
}

export const DedupRemovalForm: React.FC<DedupRemovalFormProps> = ({
  responsable,
  motivo,
  isSimulating,
  canSimulate,
  errorText,
  onResponsableChange,
  onMotivoChange,
  onSimulate,
}) => {
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSimulate();
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <p className={styles.note}>{REMOVAL_LABELS.FORM_NOTE}</p>
      <FormField
        label={REMOVAL_LABELS.RESPONSABLE_LABEL}
        icon={User}
        value={responsable}
        onChange={onResponsableChange}
        placeholder={REMOVAL_LABELS.RESPONSABLE_PLACEHOLDER}
        maxLength={RESPONSABLE_MAX_LENGTH}
        isFullWidth
      />
      <FormField
        label={REMOVAL_LABELS.MOTIVO_LABEL}
        icon={FileText}
        value={motivo}
        onChange={onMotivoChange}
        placeholder={REMOVAL_LABELS.MOTIVO_PLACEHOLDER}
        maxLength={MOTIVO_MAX_LENGTH}
        isFullWidth
      />
      {errorText && <AlertMessage type={AlertType.ERROR} text={errorText} />}
      <div className={styles.actions}>
        <Button type="submit" isDisabled={!canSimulate || isSimulating}>
          {isSimulating ? <Loader2 size={15} className={styles.spin} /> : <SearchCheck size={15} />}
          {isSimulating ? REMOVAL_LABELS.SIMULATING_BUTTON : REMOVAL_LABELS.SIMULATE_BUTTON}
        </Button>
      </div>
    </form>
  );
};
