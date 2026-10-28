"use client";

import React from "react";
import { Download } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import { downloadBlob } from "./downloadBlob";
import { reportCsvFilename } from "./reportCsv/filename";
import type { MonthlyStage } from "./monthlyCartoStages";
import styles from "./ReportDownloadButton.module.css";

const DOWNLOAD_LABEL = "Descargar CSV";
const CSV_MIME_TYPE = "text/csv;charset=utf-8";
const ICON_SIZE = 15;

export interface ReportDownloadButtonProps {
  stageSlug: MonthlyStage;
  dryRun: boolean;
  buildCsv: () => string;
}

export const ReportDownloadButton: React.FC<ReportDownloadButtonProps> = ({ stageSlug, dryRun, buildCsv }) => {
  const handleDownload = () => {
    const generatedAt = new Date();
    const blob = new Blob([buildCsv()], { type: CSV_MIME_TYPE });
    downloadBlob(blob, reportCsvFilename(stageSlug, dryRun, generatedAt));
  };

  return (
    <div className={styles.actions}>
      <Button variant={ButtonVariant.SECONDARY} onClick={handleDownload}>
        <Download size={ICON_SIZE} />
        <span>{DOWNLOAD_LABEL}</span>
      </Button>
    </div>
  );
};
