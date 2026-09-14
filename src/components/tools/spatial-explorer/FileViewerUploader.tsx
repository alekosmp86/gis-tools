import React from "react";
import { Upload, FileCheck, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import type { ParsedFileDataset } from "@/core/types/parsers";
import { formatNumber, formatFileSize } from "@/core/common/ValueFormatter";
import { useFileUploader } from "./hooks/useFileUploader";
import styles from "./FileViewerUploader.module.css";

interface FileViewerUploaderProps {
  onFileParsed: (dataset: ParsedFileDataset | null) => void;
  parsedDataset: ParsedFileDataset | null;
}

export const FileViewerUploader: React.FC<FileViewerUploaderProps> = ({
  onFileParsed,
  parsedDataset,
}) => {
  const {
    fileInputRef,
    isDragging,
    isLoading,
    errorMessage,
    handleFileSelect,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleClear,
    openFileDialog,
  } = useFileUploader({ onFileParsed });

  return (
    <div className={styles.uploadContainer}>
      {errorMessage && (
        <AlertMessage type={AlertType.ERROR} text={errorMessage} />
      )}

      {parsedDataset ? (
        <div className={styles.activeFileInfo}>
          <div className={styles.fileDetails}>
            <div className={styles.fileIconWrapper}>
              <FileCheck size={20} />
            </div>
            <div className={styles.fileTexts}>
              <div className={styles.fileName} title={parsedDataset.fileName}>
                {parsedDataset.fileName}
              </div>
              <div className={styles.fileMeta}>
                <span>{formatFileSize(parsedDataset.fileSize)}</span>
                <span>/</span>
                <span>{formatNumber(parsedDataset.featureCount)} registros</span>
              </div>
            </div>
          </div>

          <Button
            variant={ButtonVariant.SECONDARY}
            onClick={handleClear}
            type="button"
            className={styles.reloadBtn}
          >
            <RefreshCw size={14} className={styles.reloadIcon} />
            <span>Cargar otro archivo</span>
          </Button>
        </div>
      ) : (
        <div
          className={`${styles.dropZone} ${isDragging ? styles.dropZoneDragging : ""}`}
          onClick={openFileDialog}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className={styles.uploadIcon}>
            {isLoading ? <Loader2 size={24} className="spin" /> : <Upload size={24} />}
          </div>

          <div>
            <h4 className={styles.uploadTitle}>
              {isLoading ? "Procesando archivo espacial..." : "Haga clic o arrastre un archivo espacial aquí"}
            </h4>
            <p className={styles.uploadSubtitle}>
              Soporta mapas vectoriales y tablas de atributos alfanuméricas
            </p>
          </div>

          <div className={styles.formatBadges}>
            <span className={styles.formatBadge}>.ZIP (Shapefile)</span>
            <span className={styles.formatBadge}>.GEOJSON</span>
            <span className={styles.formatBadge}>.CSV (con Geom)</span>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.geojson,.json,.csv,.txt"
            onChange={handleFileSelect}
            className={styles.hiddenInput}
          />
        </div>
      )}
    </div>
  );
};
