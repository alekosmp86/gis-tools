"use client";

import React, { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import { claimAutomaticBackupDownload } from "./padronBackupAutoDownload";
import { downloadPadronBackup } from "./padronBackupDownload";
import { ReportDownloadActions } from "./ReportDownloadButton";
import { SectionTitle } from "./ReportParts";
import { ReportRowList, type ReportRowListRow } from "./ReportRowList";
import { megabytesText } from "./reportFormat";
import sharedStyles from "./CargarPadronesReport.module.css";

const TITLE = "Respaldo para revertir";
const BUTTON_LABEL = "Descargar respaldo";
const DOWNLOAD_FAILED_PREFIX = "No se pudo descargar el respaldo.";
const DOWNLOAD_FAILED_FALLBACK = "Intente de nuevo con el botón Descargar respaldo.";
const ICON_SIZE = 15;

export interface RevertBackupFileView {
  token: string;
  fileName: string;
  bytes: number;
}

export interface RevertBackupSectionProps {
  backup: RevertBackupFileView;
  rows: ReportRowListRow[];
  instructions: readonly string[];
}

const failureTextOf = (error: unknown): string =>
  `${DOWNLOAD_FAILED_PREFIX} ${error instanceof Error && error.message !== "" ? error.message : DOWNLOAD_FAILED_FALLBACK}`;

const attemptDownload = (
  token: string,
  fileName: string,
  onFailure: (text: string | null) => void,
): Promise<void> =>
  downloadPadronBackup(token, fileName).then(
    () => onFailure(null),
    (error: unknown) => onFailure(failureTextOf(error)),
  );

export const RevertBackupSection: React.FC<RevertBackupSectionProps> = ({ backup, rows, instructions }) => {
  const [failureText, setFailureText] = useState<string | null>(null);
  const { token, fileName } = backup;

  useEffect(() => {
    if (claimAutomaticBackupDownload(token)) void attemptDownload(token, fileName, setFailureText);
  }, [token, fileName]);

  return (
    <section className={sharedStyles.section}>
      <SectionTitle>{TITLE}</SectionTitle>
      <p className={sharedStyles.hint}>{`${fileName} (${megabytesText(backup.bytes)})`}</p>
      <ReportRowList rows={rows} />
      <ul className={sharedStyles.list}>
        {instructions.map((instruction) => (
          <li key={instruction}>{instruction}</li>
        ))}
      </ul>
      {failureText !== null && <AlertMessage type={AlertType.ERROR} text={failureText} />}
      <ReportDownloadActions>
        <Button variant={ButtonVariant.SECONDARY} onClick={() => void attemptDownload(token, fileName, setFailureText)}>
          <Download size={ICON_SIZE} />
          <span>{BUTTON_LABEL}</span>
        </Button>
      </ReportDownloadActions>
    </section>
  );
};
