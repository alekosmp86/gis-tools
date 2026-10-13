"use client";

import React from "react";
import { Download, Loader2 } from "lucide-react";
import { formatFileSize } from "@/core/common/ValueFormatter";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import { REPORT_KIND_LABELS, ReportKind } from "../client";
import type { ReportStatus } from "./useReportDownloads";
import shared from "./IndicatorsShared.module.css";
import styles from "./ReportDownloadButton.module.css";

interface ReportDownloadButtonProps {
  kind: ReportKind;
  status: ReportStatus;
  onDownload: () => void;
}

function describeDownload(kind: ReportKind, fileName: string, sizeBytes: number): string {
  if (kind === ReportKind.NOVEDAD && sizeBytes === 0) {
    return `Sin novedades: el archivo ${fileName} se guardó vacío (0 B).`;
  }
  return `${fileName} (${formatFileSize(sizeBytes)})`;
}

export const ReportDownloadButton: React.FC<ReportDownloadButtonProps> = ({ kind, status, onDownload }) => (
  <div className={styles.item}>
    <Button type="button" variant={ButtonVariant.SECONDARY} isDisabled={status.isPending} onClick={onDownload}>
      {status.isPending ? <Loader2 size={15} className={shared.spin} /> : <Download size={15} />}
      {REPORT_KIND_LABELS[kind]}
    </Button>
    {status.download && (
      <span className={styles.detail}>
        {describeDownload(kind, status.download.fileName, status.download.sizeBytes)}
      </span>
    )}
    {status.error && <AlertMessage type={AlertType.ERROR} text={status.error} />}
  </div>
);
