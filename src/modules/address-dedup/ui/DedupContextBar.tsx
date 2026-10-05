"use client";

import React from "react";
import { Database, MapPin, Pencil, RefreshCw } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import { DedupScope, type ExportFormat } from "../constants";
import { OPTION_CHIP_LABELS } from "../data/dedupLabels";
import type { DedupRequestPayload } from "../types";
import { DedupExportBar } from "./DedupExportBar";
import styles from "./DedupContextBar.module.css";

interface DedupContextBarProps {
  payload: DedupRequestPayload;
  provinceName?: string;
  isBusy: boolean;
  exportingFormat: ExportFormat | null;
  onEdit: () => void;
  onRerun: () => void;
  onExport: (format: ExportFormat) => void;
}

/** Summarises the parameters of the last run. The password is deliberately never rendered. */
export const DedupContextBar: React.FC<DedupContextBarProps> = ({
  payload,
  provinceName,
  isBusy,
  exportingFormat,
  onEdit,
  onRerun,
  onExport,
}) => (
  <section className={`glass-panel ${styles.bar}`} aria-label="Contexto del análisis">
    <div className={styles.context}>
      <span className={styles.target}>
        <Database size={15} />
        {payload.connection.db_name}@{payload.connection.host}
      </span>
      <span className={styles.target}>
        <MapPin size={15} />
        {provinceName || `Provincia ${payload.provinceId}`}
      </span>
      {payload.protectedSiblingRemovesLone && (
        <span className={styles.chip}>{OPTION_CHIP_LABELS.PROTECTED_SIBLING}</span>
      )}
      {payload.scope === DedupScope.ALL_DUPLICATE_GROUPS && (
        <span className={styles.chip}>{OPTION_CHIP_LABELS.INCLUDE_GROUPS}</span>
      )}
    </div>

    <div className={styles.actions}>
      <Button type="button" variant={ButtonVariant.SECONDARY} onClick={onEdit}>
        <Pencil size={15} />
        Editar parámetros
      </Button>
      <Button type="button" variant={ButtonVariant.SECONDARY} isDisabled={isBusy} onClick={onRerun}>
        <RefreshCw size={15} />
        Volver a ejecutar
      </Button>
      <DedupExportBar exportingFormat={exportingFormat} onExport={onExport} />
    </div>
  </section>
);
