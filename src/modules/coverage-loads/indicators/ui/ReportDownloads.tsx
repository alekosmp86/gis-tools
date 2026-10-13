"use client";

import React from "react";
import type { ConnectionPayload } from "../../types";
import { ReportKind } from "../client";
import { ReportDownloadButton } from "./ReportDownloadButton";
import { useReportDownloads } from "./useReportDownloads";
import styles from "./ReportDownloads.module.css";

interface ReportDownloadsProps {
  connection: ConnectionPayload;
}

const REPORT_ORDER: ReadonlyArray<ReportKind> = [ReportKind.LOCALIDAD, ReportKind.MAYOR50, ReportKind.NOVEDAD];

export const ReportDownloads: React.FC<ReportDownloadsProps> = ({ connection }) => {
  const { statuses, download } = useReportDownloads(connection);

  return (
    <section className={styles.section} aria-label="Reportes">
      <h3 className={styles.title}>Reportes</h3>
      <div className={styles.buttons}>
        {REPORT_ORDER.map((kind) => (
          <ReportDownloadButton key={kind} kind={kind} status={statuses[kind]} onDownload={() => void download(kind)} />
        ))}
      </div>
    </section>
  );
};
