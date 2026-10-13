"use client";

import React from "react";
import { FileText, X } from "lucide-react";
import { formatFileSize } from "@/core/common/ValueFormatter";
import { FILE_NAME_FORMAT_HINT } from "../client";
import styles from "./IndicatorsFileRow.module.css";

interface IndicatorsFileRowProps {
  file: File;
  onRemove: () => void;
}

export const IndicatorsFileRow: React.FC<IndicatorsFileRowProps> = ({ file, onRemove }) => (
  <li className={styles.row}>
    <FileText size={18} className={styles.icon} />
    <div className={styles.info}>
      <span className={styles.name}>{file.name}</span>
      <span className={styles.meta}>
        {formatFileSize(file.size)} · Formato esperado: {FILE_NAME_FORMAT_HINT}
      </span>
    </div>
    <button type="button" className={styles.remove} onClick={onRemove} aria-label={`Quitar ${file.name}`}>
      <X size={16} />
    </button>
  </li>
);
