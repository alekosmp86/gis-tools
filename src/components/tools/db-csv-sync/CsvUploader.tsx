import React, { useState, useRef } from "react";
import { UploadCloud, FileSpreadsheet, Trash2, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AlertMessage } from "@/components/shared/AlertMessage";
import { ColumnsList } from "@/components/shared/ColumnsList";
import { CsvParser } from "@/services/parsers/CsvParser";
import type { ParsedFileDataset } from "@/types/parsers";
import styles from "./CsvUploader.module.css";

interface CsvUploaderProps {
  onSuccess: (data: ParsedFileDataset) => void;
  onDiscard: () => void;
  loadedData?: ParsedFileDataset | null;
}

export const CsvUploader: React.FC<CsvUploaderProps> = ({
  onSuccess,
  onDiscard,
  loadedData = null,
}) => {
  const [data, setData] = useState<ParsedFileDataset | null>(loadedData);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const parser = new CsvParser();
      const parsed = await parser.parse(file);
      setData(parsed);
      onSuccess(parsed);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al procesar el archivo CSV.";
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleDropzoneKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  };

  const handleDiscard = () => {
    setData(null);
    setErrorMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    onDiscard();
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className={`glass-panel ${styles.container}`}>
      <div className={styles.header}>
        <div className={styles.headerIcon}>
          <FileSpreadsheet size={24} />
        </div>
        <div>
          <h2 className={styles.title}>2. Cargar Archivo de Datos CSV</h2>
          <p className={styles.subtitle}>
            Suba un archivo <strong>.csv</strong> delimitado por comas. Los datos se inspeccionan en la memoria local y se pueden descartar en cualquier momento.
          </p>
        </div>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".csv,.txt"
        aria-label="Seleccionar archivo CSV"
        className={styles.hiddenInput}
      />

      {/* Upload Zone */}
      {!data && !loading && (
        <div
          role="button"
          tabIndex={0}
          className={`${styles.dropzone} ${isDragOver ? styles.dragOver : ""}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={handleDropzoneKeyDown}
        >
          <div className={styles.dropIcon}>
            <UploadCloud size={36} />
          </div>
          <div className={styles.dropText}>
            <span className={styles.dropTitle}>Arrastre y suelte su archivo CSV (.csv) aquí</span>
            <span className={styles.dropSub}>o haga clic para seleccionar un archivo desde su equipo</span>
          </div>
          <div className={styles.formatBadges}>
            <span className={styles.formatBadge}>.CSV</span>
            <span className={styles.formatBadge}>DELIMITADO POR COMAS</span>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className={styles.loadingArea}>
          <Loader2 size={32} className={styles.spin} />
          <span>Leyendo e inspeccionando columnas del archivo CSV en memoria...</span>
        </div>
      )}

      {/* Error Alert */}
      {errorMessage && <AlertMessage type="error" text={errorMessage} />}

      {/* Loaded File Info Card */}
      {data && (
        <div className={styles.loadedCard}>
          <div className={styles.loadedHeader}>
            <div className={styles.fileMeta}>
              <FileSpreadsheet size={28} className={styles.successIcon} />
              <div>
                <div className={styles.fileName}>{data.fileName}</div>
                <div className={styles.fileSub}>
                  Tamaño: {formatSize(data.fileSize)} &bull; {data.featureCount.toLocaleString()} filas
                </div>
              </div>
            </div>

            <Button variant="ghost" onClick={handleDiscard}>
              <Trash2 size={16} color="var(--accent-rose)" />
              <span className={styles.discardText}>Descartar archivo</span>
            </Button>
          </div>

          <div className={styles.metaRow}>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Total de Filas / Registros:</span>
              <span className={styles.metaValue}>{data.featureCount.toLocaleString()} filas</span>
            </div>

            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Columnas Encontradas:</span>
              <span className={styles.metaValue}>{data.attributes.length} columnas</span>
            </div>
          </div>

          {/* Reusable ColumnsList component for CSV Header tags */}
          <ColumnsList
            columns={data.attributes}
            title="Encabezados / Columnas del Archivo CSV"
          />

          <div className={styles.proceedRow}>
            <Button variant="primary" onClick={() => onSuccess(data)}>
              <span>Continuar al Paso 3: Mapeo SUID y Atributos</span>
              <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
