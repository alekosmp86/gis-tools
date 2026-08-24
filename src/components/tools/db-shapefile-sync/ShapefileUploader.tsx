import React, { useState, useRef } from "react";
import { UploadCloud, FileCheck, Trash2, ArrowRight, Layers, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AlertMessage } from "@/components/shared/AlertMessage";
import { ColumnsList } from "@/components/shared/ColumnsList";
import { ShapefileParser } from "@/services/parsers/ShapefileParser";
import type { ShapefileUploaderProps } from "@/types/shp";
import type { ParsedFileDataset } from "@/types/parsers";
import styles from "./ShapefileUploader.module.css";

export const ShapefileUploader: React.FC<ShapefileUploaderProps> = ({
  onSuccess,
  onDiscard,
  loadedData = null,
}) => {
  const [data, setData] = useState<ParsedFileDataset | null>(
    loadedData ? (loadedData as unknown as ParsedFileDataset) : null
  );
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const parser = new ShapefileParser();
      const parsed = await parser.parse(file);
      setData(parsed);
      onSuccess(parsed as unknown as import("@/types/shp").ParsedShapefileData);
      setLoading(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al procesar el archivo Shapefile.";
      setErrorMessage(msg);
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
          <Layers size={24} />
        </div>
        <div>
          <h2 className={styles.title}>2. Cargar Capa Espacial Shapefile</h2>
          <p className={styles.subtitle}>
            Suba un archivo <strong>.zip</strong> (que contenga los archivos .shp, .dbf, .shx) o un archivo <strong>.geojson</strong>. Los datos se procesan en la memoria local y se pueden descartar en cualquier momento.
          </p>
        </div>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".zip,.geojson,.json"
        aria-label="Seleccionar archivo Shapefile o GeoJSON"
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
            <span className={styles.dropTitle}>Arrastre y suelte su archivo Shapefile (.zip) o GeoJSON aquí</span>
            <span className={styles.dropSub}>o haga clic para seleccionar un archivo desde su equipo</span>
          </div>
          <div className={styles.formatBadges}>
            <span className={styles.formatBadge}>.ZIP (SHP + DBF)</span>
            <span className={styles.formatBadge}>.GEOJSON</span>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className={styles.loadingArea}>
          <Loader2 size={32} className={styles.spin} />
          <span>Leyendo e inspeccionando atributos del Shapefile en memoria...</span>
        </div>
      )}

      {/* Error Alert */}
      {errorMessage && <AlertMessage type="error" text={errorMessage} />}

      {/* Loaded File Info Card */}
      {data && (
        <div className={styles.loadedCard}>
          <div className={styles.loadedHeader}>
            <div className={styles.fileMeta}>
              <FileCheck size={28} className={styles.successIcon} />
              <div>
                <div className={styles.fileName}>{data.fileName}</div>
                <div className={styles.fileSub}>
                  Tamaño: {formatSize(data.fileSize)} &bull; Tipo: {data.geometryType || "Desconocido"}
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
              <span className={styles.metaLabel}>Total de Geometrías Espaciales:</span>
              <span className={styles.metaValue}>{data.featureCount.toLocaleString()} entidades</span>
            </div>

            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Tipo de Geometría:</span>
              <span className={styles.metaValue}>{data.geometryType || "Desconocido"}</span>
            </div>
          </div>

          {/* Reusable ColumnsList component for DBF Attribute tags */}
          <ColumnsList
            columns={data.attributes}
            title="Atributos Encontrados en DBF"
          />

          <div className={styles.proceedRow}>
            <Button variant="primary" onClick={() => onSuccess(data as unknown as import("@/types/shp").ParsedShapefileData)}>
              <span>Continuar al Paso 3: Mapeo SUID y Atributos</span>
              <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
