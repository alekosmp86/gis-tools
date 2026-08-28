import React, { useState, useRef } from "react";
import dynamic from "next/dynamic";
import { useQueryClient } from "@tanstack/react-query";
import { UploadCloud, FileCheck, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AlertMessage } from "@/components/shared/AlertMessage";
import { ColumnsList } from "@/components/shared/ColumnsList";
import { ShapefileParser } from "@/services/parsers/ShapefileParser";
import type { ParsedShapefileData } from "@/types/shp";
import type { ISpatialFileParser, ParsedFileDataset } from "@/types/parsers";
import { formatNumber, formatFileSize } from "@/utils/formatters";
import styles from "./ShapefileUploader.module.css";

const SpatialMapPreview = dynamic(
  () => import("@/components/shared/SpatialMapPreview").then((module) => module.SpatialMapPreview),
  { ssr: false }
);

export interface ShapefileUploaderProps {
  onSuccess: (data: ParsedShapefileData) => void;
  onDiscard: () => void;
  loadedData?: ParsedShapefileData | null;
}

export const ShapefileUploader: React.FC<ShapefileUploaderProps> = ({
  onSuccess,
  onDiscard,
  loadedData = null,
}) => {
  const queryClient = useQueryClient();
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
    queryClient.removeQueries({ queryKey: ["datasetComparison"] });

    try {
      const parser: ISpatialFileParser = new ShapefileParser();
      const parsed = await parser.parse(file);
      setData(parsed);
      onSuccess(parsed as unknown as ParsedShapefileData);
      setLoading(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al procesar el archivo Shapefile.";
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
                  Tamaño: {formatFileSize(data.fileSize)} &bull; Tipo: {data.geometryType || "Desconocido"}
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
              <span className={styles.metaValue}>{formatNumber(data.featureCount)} entidades</span>
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

          {/* Interactive Spatial Map Preview if Shapefile/GeoJSON contains geometry */}
          {data.geojson && data.geojson.features && data.geojson.features.length > 0 && (
            <div className={styles.mapSection}>
              <SpatialMapPreview
                geojson={data.geojson}
                title="VISTA PREVIA ESPACIAL DE CAPA VECTORIAL"
              />
            </div>
          )}

        </div>
      )}
    </div>
  );
};
