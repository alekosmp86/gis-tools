import React from "react";
import {
  DefaultFileSourceTab,
  type FileSourceTabExtension,
  type SupportedExtensionFormat,
} from "@/types/extensions";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { FileSourceTabs } from "@/components/shared/FileSourceTabs";
import { useFileDrop } from "@/hooks/useFileDrop";
import styles from "./FileSourceSelectionArea.module.css";

export interface FileSourceSelectionAreaProps {
  extensions: readonly FileSourceTabExtension[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  format: SupportedExtensionFormat;
  onSelectFile: (file: File) => void;
  isLoading: boolean;
  accept: string;
  inputAriaLabel: string;
  dropzoneTitle: string;
  dropzoneSubtitle: string;
  dropzoneFormatBadges: readonly string[];
}

export const FileSourceSelectionArea: React.FC<FileSourceSelectionAreaProps> = ({
  extensions,
  activeTabId,
  onSelectTab,
  format,
  onSelectFile,
  isLoading,
  accept,
  inputAriaLabel,
  dropzoneTitle,
  dropzoneSubtitle,
  dropzoneFormatBadges,
}) => {
  const {
    isDragOver,
    fileInputRef,
    handleFileChange,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleKeyDown,
    openFileDialog,
  } = useFileDrop({ onFileSelected: onSelectFile });

  const activeExtension = extensions.find((extension) => extension.id === activeTabId);
  const isPcActive = activeTabId === DefaultFileSourceTab.PC || !activeExtension;

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept={accept}
        aria-label={inputAriaLabel}
        className={styles.hiddenInput}
      />

      <FileSourceTabs
        extensions={extensions}
        activeTabId={activeTabId}
        onSelectTab={onSelectTab}
        pcUploadLabel="Subir desde PC"
      />

      {activeExtension &&
        activeExtension.renderSelector({
          format,
          onSelectFile,
          isLoading,
        })}

      {isPcActive && (
        <FileDropzone
          isDragOver={isDragOver}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={openFileDialog}
          onKeyDown={handleKeyDown}
          title={dropzoneTitle}
          subtitle={dropzoneSubtitle}
          formatBadges={dropzoneFormatBadges}
        />
      )}
    </>
  );
};
