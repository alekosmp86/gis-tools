import React from "react";
import { AlertTriangle, ScanSearch } from "lucide-react";
import type { ShpReplaceRunContext } from "@/core/services/shpReplaceRunStore";
import styles from "./ShpReplaceRunPanel.module.css";

export interface ShpReplaceRunHeaderProps {
  title: string;
  context: ShpReplaceRunContext;
  dryRun: boolean;
}

const REPLACE_TONE = {
  Icon: AlertTriangle,
  headerClass: styles.header,
  iconClass: styles.headerIcon,
  titleClass: styles.title,
};

const ANALYSIS_TONE = {
  Icon: ScanSearch,
  headerClass: styles.headerAnalysis,
  iconClass: styles.headerIconAnalysis,
  titleClass: styles.titleAnalysis,
};

export const ShpReplaceRunHeader: React.FC<ShpReplaceRunHeaderProps> = ({ title, context, dryRun }) => {
  const tone = dryRun ? ANALYSIS_TONE : REPLACE_TONE;
  return (
    <div className={tone.headerClass}>
      <tone.Icon size={36} className={tone.iconClass} />
      <div className={styles.headerContent}>
        <span className={tone.titleClass}>{title}</span>
        {dryRun && <span className={styles.analysisSubtitle}>Esta operación no modifica la tabla destino.</span>}
        <span className={styles.label}>Tabla destino</span>
        <span className={styles.server}>{context.targetServer}</span>
        <span className={styles.table}>{context.targetLabel}</span>
        <span className={styles.label}>Archivo</span>
        <span className={styles.server}>{context.fileName}</span>
      </div>
    </div>
  );
};
