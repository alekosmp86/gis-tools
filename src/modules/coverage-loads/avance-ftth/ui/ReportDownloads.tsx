"use client";

import React from "react";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { ConnectionPayload } from "../../types";
import { REPORT_KIND_LABELS, REPORT_KINDS } from "../client";
import { ReportDownloadButton } from "./ReportDownloadButton";
import { useReportDownloads, ZIP_KEY } from "./useReportDownloads";
import styles from "./ReportDownloads.module.css";

interface ReportDownloadsProps {
  connection: ConnectionPayload;
}

const ZIP_LABEL = "Todos los reportes (ZIP)";

/** Reports of the Avance FTTH stage: they read the current database state, whatever was loaded in this session. */
export const AvanceReportDownloads: React.FC<ReportDownloadsProps> = ({ connection }) => {
  const { statuses, download } = useReportDownloads(connection);

  return (
    <section className={styles.section} aria-label="Reportes del Avance FTTH">
      <h3 className={styles.title}>Reportes del Avance FTTH</h3>
      <div className={styles.buttons}>
        <ReportDownloadButton
          label={ZIP_LABEL}
          status={statuses[ZIP_KEY]}
          variant={ButtonVariant.PRIMARY}
          onDownload={() => void download(ZIP_KEY)}
        />
        {REPORT_KINDS.map((kind) => (
          <ReportDownloadButton
            key={kind}
            label={REPORT_KIND_LABELS[kind]}
            status={statuses[kind]}
            variant={ButtonVariant.SECONDARY}
            onDownload={() => void download(kind)}
          />
        ))}
      </div>
    </section>
  );
};
