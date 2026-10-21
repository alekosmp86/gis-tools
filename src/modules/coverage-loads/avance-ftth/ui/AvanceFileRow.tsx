"use client";

import React from "react";
import { FileText, X } from "lucide-react";
import { formatFileSize } from "@/core/common/ValueFormatter";
import { FILE_KIND_LABELS, type AvanceFileKind } from "../client";
import styles from "./AvanceFileRow.module.css";

interface AvanceFileRowProps {
  file: File;
  kind: AvanceFileKind | null;
  onRemove: () => void;
}

const UNRECOGNIZED_LABEL = "Nombre no reconocido";

export const AvanceFileRow: React.FC<AvanceFileRowProps> = ({ file, kind, onRemove }) => (
  <li className={styles.row}>
    <FileText size={18} className={styles.icon} />
    <div className={styles.info}>
      <span className={styles.name}>{file.name}</span>
      <span className={styles.meta}>
        {formatFileSize(file.size)} · {kind === null ? UNRECOGNIZED_LABEL : FILE_KIND_LABELS[kind]}
      </span>
    </div>
    <button type="button" className={styles.remove} onClick={onRemove} aria-label={`Quitar ${file.name}`}>
      <X size={16} />
    </button>
  </li>
);
