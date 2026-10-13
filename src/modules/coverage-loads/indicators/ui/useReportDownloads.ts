"use client";

import { useState } from "react";
import type { ConnectionPayload } from "../../types";
import { ReportKind } from "../client";
import { downloadReport, type ReportDownload } from "./indicatorsClient";

const UNKNOWN_FAILURE = "No se pudo generar el reporte.";

export interface ReportStatus {
  readonly isPending: boolean;
  readonly download: ReportDownload | null;
  readonly error: string | null;
}

const IDLE_STATUS: ReportStatus = { isPending: false, download: null, error: null };

type StatusByKind = Readonly<Record<ReportKind, ReportStatus>>;

const INITIAL_STATUSES: StatusByKind = {
  [ReportKind.LOCALIDAD]: IDLE_STATUS,
  [ReportKind.MAYOR50]: IDLE_STATUS,
  [ReportKind.NOVEDAD]: IDLE_STATUS,
};

/** Generates one report CSV on demand and saves it with the file name the server chose. */
export function useReportDownloads(connection: ConnectionPayload) {
  const [statuses, setStatuses] = useState<StatusByKind>(INITIAL_STATUSES);

  const updateStatus = (kind: ReportKind, status: ReportStatus) =>
    setStatuses((previous) => ({ ...previous, [kind]: status }));

  const download = async (kind: ReportKind) => {
    updateStatus(kind, { isPending: true, download: null, error: null });
    try {
      const saved = await downloadReport(connection, kind);
      updateStatus(kind, { isPending: false, download: saved, error: null });
    } catch (failure: unknown) {
      const message = failure instanceof Error ? failure.message : UNKNOWN_FAILURE;
      updateStatus(kind, { isPending: false, download: null, error: message });
    }
  };

  return { statuses, download };
}
