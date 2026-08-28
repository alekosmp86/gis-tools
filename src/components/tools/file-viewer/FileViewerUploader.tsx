import React, { useRef, useState } from "react";
import { Upload, FileCheck, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AlertMessage } from "@/components/shared/AlertMessage";
import { AlertType, ButtonVariant } from "@/types/ui";
import type { ParsedFileDataset } from "@/types/parsers";
import { ShapefileParser } from "@/services/parsers/ShapefileParser";
import { CsvParser } from "@/services/parsers/CsvParser";
import { formatNumber, formatFileSize } from "@/utils/formatters";
import styles from "./FileViewerUploader.module.css";

interface FileViewerUploaderProps {
  onFileParsed: (dataset: ParsedFileDataset | null) => void;
  parsedDataset: ParsedFileDataset | null;
}

export const FileViewerUploader: React.FC<FileViewerUploaderProps> = ({
  onFileParsed,
  parsedDataset,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const processFile = (file: File) => {
    setIsLoading(true);
    setErrorMessage(null);

    const fileName = file.name.toLowerCase();
    let parser;

    if (fileName.endsWith(".zip") || fileName.endsWith(".geojson") || fileName.endsWith(".json")) {
      parser = new ShapefileParser();
    } else if (fileName.endsWith(".csv") || fileName.endsWith(".txt")) {
      parser = new CsvParser();
    } else {
      setIsLoading(false);
      setErrorMessage("Formato de archivo no soportado. Por favor suba un archivo .zip (Shapefile), .geojson o .csv.");
      return;
    }

    parser
      .parse(file)
      .then((dataset) => {
        onFileParsed(dataset);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Error al procesar el archivo espacial.";
        setErrorMessage(msg);
        onFileParsed(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleClear = () => {
    onFileParsed(null);
    setErrorMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className={styles.uploadContainer}>
      {errorMessage && (
        <AlertMessage type={AlertType.ERROR} text={errorMessage} />
      )}

      {parsedDataset ? (
        <div className={styles.activeFileInfo}>
          <div className={styles.fileDetails}>
            <div className={styles.fileIconWrapper}>
              <FileCheck size={20} className={styles.fileIcon} />
            </div>
            <div className={styles.fileTexts}>
              <div className={styles.fileName} title={parsedDataset.fileName}>
                {parsedDataset.fileName}
              </div>
              <div className={styles.fileMeta}>
                {formatFileSize(parsedDataset.fileSize)} &bull; {formatNumber(parsedDataset.featureCount)} registros
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
          onClick={() => fileInputRef.current?.click()}
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
