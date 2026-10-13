"use client";

import React from "react";
import { FileText, X } from "lucide-react";
import { formatFileSize } from "@/core/common/ValueFormatter";
import type { JobTarget } from "../job/types.ts";
import styles from "./ShpFileSummary.module.css";

interface ShpFileSummaryProps {
  fileName: string;
  sizeBytes: number;
  target: JobTarget;
  onRemove?: () => void;
}

/** The chosen or uploaded file, with the table it will replace and the cut date taken from its name. */
export const ShpFileSummary: React.FC<ShpFileSummaryProps> = ({ fileName, sizeBytes, target, onRemove }) => (
  <div className={styles.row}>
    <FileText size={18} className={styles.icon} />
    <div className={styles.info}>
      <span className={styles.name}>{fileName}</span>
      <span className={styles.meta}>
        {formatFileSize(sizeBytes)} · Tabla de destino: public.{target.table} · Corte {target.fechaact}
      </span>
    </div>
    {onRemove && (
      <button type="button" className={styles.remove} onClick={onRemove} aria-label={`Quitar ${fileName}`}>
        <X size={16} />
      </button>
    )}
  </div>
);
