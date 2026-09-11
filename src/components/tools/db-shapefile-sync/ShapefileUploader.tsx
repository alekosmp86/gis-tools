import React, { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import { ProgressBar } from "@/ui-kit/components/ProgressBar";
import { ShapefileParser } from "@/core/services/parsers/ShapefileParser";
import type { ParsedShapefileData } from "@/core/types/shp";
import type { ISpatialFileParser, ParsedFileDataset, FileParseProgress } from "@/core/types/parsers";
import { FileDropzone } from "@/ui-kit/components/FileDropzone";
import { ModuleTabbedSlot } from "@/ui-kit/modules/ModuleTabbedSlot";
import { FileSourceSlotProvider } from "@/ui-kit/modules/FileSourceSlotContext";
import { UiSlot, FileSourceFormat } from "@/ui-kit/modules/contracts";
import { LoadedShapefileCard } from "./LoadedShapefileCard";
import styles from "./ShapefileUploader.module.css";


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
  const [progress, setProgress] = useState<FileParseProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    setLoading(true);
    setProgress(null);
    setErrorMessage(null);
    queryClient.removeQueries({ queryKey: ["datasetComparison"] });

    try {
      const parser: ISpatialFileParser = new ShapefileParser();
      const parsed = await parser.parse(file, (phase: string, current: number, total: number) => {
        const percentage = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
        setProgress({
          phase,
          current,
          total,
          pct: percentage,
        });
      });
      setData(parsed);
      onSuccess(parsed as unknown as ParsedShapefileData);
      setLoading(false);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Error al procesar el archivo Shapefile.";
      setErrorMessage(message);
      setLoading(false);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleDropzoneKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInputRef.current?.click();
    }
  };

  const handleDiscard = () => {
    queryClient.removeQueries({ queryKey: ["datasetComparison"] });
    setData(null);
    setProgress(null);
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

      {/* Upload Dropzone */}
      {!data && !loading && (
        <FileSourceSlotProvider
          value={{
            toolId: "db-shapefile-sync",
            format: FileSourceFormat.SHP,
            onSelectFile: processFile,
            isLoading: loading,
          }}
        >
          <ModuleTabbedSlot slot={UiSlot.FILE_SOURCE_TABS} defaultLabel="Subir desde PC">
            <FileDropzone
              isDragOver={isDragOver}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={handleDropzoneKeyDown}
              title="Arrastre y suelte su archivo Shapefile (.zip) o GeoJSON aquí"
              subtitle="o haga clic para seleccionar un archivo desde su equipo"
              formatBadges={[".ZIP (SHP + DBF)", ".GEOJSON"]}
            />
          </ModuleTabbedSlot>
        </FileSourceSlotProvider>
      )}

      {/* Loading State */}
      {loading && (
        <div className={styles.loadingArea}>
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
              <span>Leyendo e inspeccionando atributos del Shapefile en memoria...</span>
            </>
          )}
        </div>
      )}

      {/* Error Alert */}
      {errorMessage && <AlertMessage type={AlertType.ERROR} text={errorMessage} />}

      {/* Loaded File Metadata & Spatial Map Card */}
      {data && <LoadedShapefileCard data={data} onDiscard={handleDiscard} />}
    </div>
  );
};
