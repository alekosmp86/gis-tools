"use client";

import React from "react";
import { Download, Loader2 } from "lucide-react";
import { formatFileSize } from "@/core/common/ValueFormatter";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import type { ReportStatus } from "./useReportDownloads";
import shared from "./AvanceShared.module.css";
import styles from "./ReportDownloadButton.module.css";

interface ReportDownloadButtonProps {
  label: string;
  status: ReportStatus;
  variant: ButtonVariant;
  onDownload: () => void;
}

export const ReportDownloadButton: React.FC<ReportDownloadButtonProps> = ({ label, status, variant, onDownload }) => (
  <div className={styles.item}>
    <Button type="button" variant={variant} isDisabled={status.isPending} onClick={onDownload}>
      {status.isPending ? <Loader2 size={15} className={shared.spin} /> : <Download size={15} />}
      {label}
    </Button>
    {status.download && (
      <span className={styles.detail}>
        {status.download.fileName} ({formatFileSize(status.download.sizeBytes)})
      </span>
    )}
    {status.error && <AlertMessage type={AlertType.ERROR} text={status.error} />}
  </div>
);
