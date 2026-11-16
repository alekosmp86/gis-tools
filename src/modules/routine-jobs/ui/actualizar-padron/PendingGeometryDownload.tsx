"use client";

import React, { useState } from "react";
import { Download } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import { downloadPendingGeometryCsv } from "./pendingGeometryCsvDownload";

const BUTTON_LABEL = "Descargar geometrías pendientes (CSV)";
const DOWNLOAD_FAILED_PREFIX = "No se pudieron descargar las geometrías pendientes.";
const DOWNLOAD_FAILED_FALLBACK = "Intente de nuevo con el botón Descargar geometrías pendientes (CSV).";
const ICON_SIZE = 15;

export interface PendingGeometryDownloadProps {
  planId: string;
}

const failureTextOf = (error: unknown): string =>
  `${DOWNLOAD_FAILED_PREFIX} ${error instanceof Error && error.message !== "" ? error.message : DOWNLOAD_FAILED_FALLBACK}`;

export const PendingGeometryDownload: React.FC<PendingGeometryDownloadProps> = ({ planId }) => {
  const [failureText, setFailureText] = useState<string | null>(null);

  const handleDownload = () => {
    void downloadPendingGeometryCsv(planId).then(
      () => setFailureText(null),
      (error: unknown) => setFailureText(failureTextOf(error)),
    );
  };

  return (
    <>
      <Button variant={ButtonVariant.SECONDARY} onClick={handleDownload}>
        <Download size={ICON_SIZE} />
        <span>{BUTTON_LABEL}</span>
      </Button>
      {failureText !== null && <AlertMessage type={AlertType.ERROR} text={failureText} />}
    </>
  );
};
