"use client";

import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import type { DbConfig } from "@/core/types/db";
import { DedupConnectionForm } from "./DedupConnectionForm";
import { DedupOptionsPanel } from "./DedupOptionsPanel";
import styles from "./DedupConfigCard.module.css";

interface DedupConfigCardProps {
  config: DbConfig;
  provinceId: string;
  protectedSiblingRemovesLone: boolean;
  includeGroupsWithoutRemovals: boolean;
  isSubmitting: boolean;
  errorText: string | null;
  onConfigChange: (field: keyof DbConfig, value: string) => void;
  onProfileLoaded: (config: Partial<DbConfig>) => void;
  onProvinceChange: (value: string) => void;
  onProtectedSiblingChange: (value: boolean) => void;
  onIncludeGroupsChange: (value: boolean) => void;
  onSubmit: () => void;
  onCancel?: () => void;
}

export const DedupConfigCard: React.FC<DedupConfigCardProps> = ({
  config,
  provinceId,
  protectedSiblingRemovesLone,
  includeGroupsWithoutRemovals,
  isSubmitting,
  errorText,
  onConfigChange,
  onProfileLoaded,
  onProvinceChange,
  onProtectedSiblingChange,
  onIncludeGroupsChange,
  onSubmit,
  onCancel,
}) => (
  <section className={`glass-panel ${styles.card}`} aria-labelledby="dedup-config-title">
    <h2 id="dedup-config-title" className={styles.title}>
      Configuración
    </h2>
    <DedupConnectionForm
      config={config}
      provinceId={provinceId}
      isSubmitting={isSubmitting}
      onConfigChange={onConfigChange}
      onProfileLoaded={onProfileLoaded}
      onProvinceChange={onProvinceChange}
      onSubmit={onSubmit}
    >
      <DedupOptionsPanel
        protectedSiblingRemovesLone={protectedSiblingRemovesLone}
        includeGroupsWithoutRemovals={includeGroupsWithoutRemovals}
        onProtectedSiblingChange={onProtectedSiblingChange}
        onIncludeGroupsChange={onIncludeGroupsChange}
      />
    </DedupConnectionForm>
    {errorText && <AlertMessage type={AlertType.ERROR} text={errorText} />}
    {onCancel && (
      <div className={styles.cancelRow}>
        <Button type="button" variant={ButtonVariant.GHOST} onClick={onCancel}>
          Cancelar edición
        </Button>
      </div>
    )}
  </section>
);
