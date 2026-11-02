"use client";

import React from "react";
import { Download } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import { downloadBlob } from "./downloadBlob";
import { REPORT_CSV_KIND, reportCsvFilename, type ReportCsvKind } from "./reportCsv/filename";
import type { MonthlyStage } from "./monthlyCartoStages";
import styles from "./ReportDownloadButton.module.css";

const DOWNLOAD_LABEL: Record<ReportCsvKind, string> = {
  [REPORT_CSV_KIND.CHANGES]: "Descargar CSV",
  [REPORT_CSV_KIND.INCONSISTENCIES]: "Descargar inconsistencias",
  [REPORT_CSV_KIND.MISSING]: "Descargar padrones faltantes",
  [REPORT_CSV_KIND.PENDING_GEOMETRIES]: "Descargar geometrías pendientes (CSV)",
  [REPORT_CSV_KIND.REMOVAL_MARKS]: "Descargar padrones marcados para eliminar (CSV)",
};
const CSV_MIME_TYPE = "text/csv;charset=utf-8";
const ICON_SIZE = 15;

export interface ReportDownloadButtonProps {
  stageSlug: MonthlyStage;
  dryRun: boolean;
  buildCsv: () => string;
  kind?: ReportCsvKind;
  disabled?: boolean;
}

export const ReportDownloadButton: React.FC<ReportDownloadButtonProps> = ({
  stageSlug,
  dryRun,
  buildCsv,
  kind = REPORT_CSV_KIND.CHANGES,
  disabled = false,
}) => {
  const handleDownload = () => {
    const generatedAt = new Date();
    const blob = new Blob([buildCsv()], { type: CSV_MIME_TYPE });
    downloadBlob(blob, reportCsvFilename(stageSlug, dryRun, generatedAt, kind));
  };

  return (
    <Button variant={ButtonVariant.SECONDARY} onClick={handleDownload} disabled={disabled}>
      <Download size={ICON_SIZE} />
      <span>{DOWNLOAD_LABEL[kind]}</span>
    </Button>
  );
};

export const ReportDownloadActions: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className={styles.actions}>{children}</div>
);
