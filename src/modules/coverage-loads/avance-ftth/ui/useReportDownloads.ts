"use client";

import { useState } from "react";
import type { ConnectionPayload } from "../../types";
import { REPORT_KINDS, type ReportKind } from "../client";
import { downloadReport, type ReportDownload } from "./avanceFtthClient";

const UNKNOWN_FAILURE = "No se pudo generar el reporte.";

/** The zip of all five reports is one more thing to download, keyed apart from the kinds. */
export const ZIP_KEY = "zip";

export type DownloadKey = ReportKind | typeof ZIP_KEY;

export interface ReportStatus {
  readonly isPending: boolean;
  readonly download: ReportDownload | null;
  readonly error: string | null;
}

const IDLE_STATUS: ReportStatus = { isPending: false, download: null, error: null };

type StatusByKey = Readonly<Record<DownloadKey, ReportStatus>>;

const INITIAL_STATUSES = Object.fromEntries(
  [...REPORT_KINDS, ZIP_KEY].map((key) => [key, IDLE_STATUS])
) as StatusByKey;

/** Generates the reports on demand (the zip or one file) and saves them with the name the server chose. */
export function useReportDownloads(connection: ConnectionPayload) {
  const [statuses, setStatuses] = useState<StatusByKey>(INITIAL_STATUSES);

  const updateStatus = (key: DownloadKey, status: ReportStatus) =>
    setStatuses((previous) => ({ ...previous, [key]: status }));

  const download = async (key: DownloadKey) => {
    updateStatus(key, { isPending: true, download: null, error: null });
    try {
      const saved = await downloadReport(connection, key === ZIP_KEY ? null : key);
      updateStatus(key, { isPending: false, download: saved, error: null });
    } catch (failure: unknown) {
      const message = failure instanceof Error ? failure.message : UNKNOWN_FAILURE;
      updateStatus(key, { isPending: false, download: null, error: message });
    }
  };

  return { statuses, download };
}
