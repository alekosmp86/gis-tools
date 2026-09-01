import React, { useState, useRef } from "react";
import dynamic from "next/dynamic";
import { useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AlertMessage } from "@/components/shared/AlertMessage";
import { ColumnsList } from "@/components/shared/ColumnsList";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { CsvParser } from "@/services/parsers/CsvParser";
import type { ISpatialFileParser, ParsedFileDataset } from "@/types/parsers";
import { formatNumber, formatFileSize } from "@/utils/formatters";
import styles from "./CsvUploader.module.css";

const SpatialMapPreview = dynamic(
  () => import("@/components/shared/SpatialMapPreview").then((module) => module.SpatialMapPreview),
  { ssr: false }
);

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
  const queryClient = useQueryClient();
  const [data, setData] = useState<ParsedFileDataset | null>(loadedData);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    setLoading(true);
    setErrorMessage(null);
    queryClient.removeQueries({ queryKey: ["datasetComparison"] });

    try {
      const parser: ISpatialFileParser = new CsvParser();
      const parsed = await parser.parse(file);
      setData(parsed);
      onSuccess(parsed);
      setLoading(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al procesar el archivo CSV.";
      setErrorMessage(msg);
      setLoading(false);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleDropzoneKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInputRef.current?.click();
    }
  };

  const handleDiscard = () => {
    queryClient.removeQueries({ queryKey: ["datasetComparison"] });
    setData(null);
    setErrorMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    onDiscard();
  };

  return (
    <div className={styles.container}>
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
        <FileDropzone
          isDragOver={isDragOver}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={handleDropzoneKeyDown}
          title="Arrastre y suelte su archivo CSV (.csv) aquí"
          subtitle="o haga clic para seleccionar un archivo desde su equipo"
          formatBadges={[".CSV", "DELIMITADO POR COMAS"]}
        />
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
                  Tamaño: {formatFileSize(data.fileSize)} &bull; {formatNumber(data.featureCount)} filas
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
              <span className={styles.metaValue}>{formatNumber(data.featureCount)} filas</span>
            </div>

            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Columnas Encontradas:</span>
              <span className={styles.metaValue}>{formatNumber(data.attributes.length)} columnas</span>
            </div>
          </div>

          {/* Reusable ColumnsList component for CSV Header tags */}
          <ColumnsList
            columns={data.attributes}
            title="Encabezados / Columnas del Archivo CSV"
          />

          {/* Interactive Spatial Map Preview if CSV contains Geometry (EWKB / WKT / GeoJSON) */}
          {data.geojson && data.geojson.features && data.geojson.features.length > 0 && (
            <div className={styles.mapSection}>
              <SpatialMapPreview
                geojson={data.geojson}
                title="VISTA PREVIA ESPACIAL DEL ARCHIVO CSV"
              />
            </div>
          )}

        </div>
      )}
    </div>
  );
};
