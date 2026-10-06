import React from "react";
import { Loader2 } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { FileDropzone } from "@/ui-kit/components/FileDropzone";
import { ProgressBar } from "@/ui-kit/components/ProgressBar";
import { ModuleTabbedSlot } from "@/ui-kit/modules/ModuleTabbedSlot";
import { FileSourceSlotProvider } from "@/ui-kit/modules/FileSourceSlotContext";
import { UiSlot, FileSourceFormat } from "@/ui-kit/modules/contracts";
import { AlertType } from "@/ui-kit/types/ui";
import type { SpatialFileUpload } from "./useSpatialFileUpload";
import styles from "./FileUploadArea.module.css";

export interface FileUploadAreaProps {
  upload: SpatialFileUpload;
  accept: string;
  inputAriaLabel: string;
  toolId: string;
  format: FileSourceFormat;
  dropzoneTitle: string;
  dropzoneSubtitle: string;
  formatBadges: string[];
  loadingMessage: string;
  compactLoading?: boolean;
  children?: React.ReactNode;
}

export const FileUploadArea: React.FC<FileUploadAreaProps> = ({
  upload,
  accept,
  inputAriaLabel,
  toolId,
  format,
  dropzoneTitle,
  dropzoneSubtitle,
  formatBadges,
  loadingMessage,
  compactLoading = false,
  children,
}) => {
  const { data, loading, progress, errorMessage, isDragOver, fileInputRef } = upload;

  return (
    <div className={styles.container}>
      <input
        type="file"
        ref={fileInputRef}
        onChange={upload.handleFileChange}
        accept={accept}
        aria-label={inputAriaLabel}
        className={styles.hiddenInput}
      />

      {!data && !loading && (
        <FileSourceSlotProvider
          value={{
            toolId,
            format,
            onSelectFile: upload.processFile,
            isLoading: loading,
          }}
        >
          <ModuleTabbedSlot slot={UiSlot.FILE_SOURCE_TABS} defaultLabel="Subir desde PC">
            <FileDropzone
              isDragOver={isDragOver}
              onDragOver={upload.handleDragOver}
              onDragLeave={upload.handleDragLeave}
              onDrop={upload.handleDrop}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={upload.handleDropzoneKeyDown}
              title={dropzoneTitle}
              subtitle={dropzoneSubtitle}
              formatBadges={formatBadges}
            />
          </ModuleTabbedSlot>
        </FileSourceSlotProvider>
      )}

      {loading && (
        <div
          className={`${styles.loadingArea} ${compactLoading ? styles.loadingAreaCompact : ""}`}
        >
          {progress && progress.total > 0 ? (
            <div className={styles.progressWrapper}>
              <ProgressBar
                phase={progress.phase}
                current={progress.current}
                total={progress.total}
                pct={progress.pct}
              />
            </div>
          ) : (
            <>
              <Loader2 size={32} className={styles.spin} />
              <span>{loadingMessage}</span>
            </>
          )}
        </div>
      )}

      {errorMessage && <AlertMessage type={AlertType.ERROR} text={errorMessage} />}

      {children}
    </div>
  );
};
