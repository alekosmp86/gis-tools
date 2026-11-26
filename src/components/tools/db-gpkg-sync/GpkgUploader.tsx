import React, { useRef, useState } from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { FileDropzone } from "@/ui-kit/components/FileDropzone";
import { ProgressBar } from "@/ui-kit/components/ProgressBar";
import { AlertType } from "@/ui-kit/types/ui";
import styles from "./GpkgUploader.module.css";

const UPLOAD_PHASE_LABEL = "Subiendo archivo GeoPackage";
const FORMAT_BADGES = [".GPKG", "GEOPACKAGE"];

export interface GpkgUploaderProps {
  isUploading: boolean;
  uploadPct: number;
  errorMessage: string | null;
  onSelectFile: (file: File) => void;
}

export const GpkgUploader: React.FC<GpkgUploaderProps> = ({ isUploading, uploadPct, errorMessage, onSelectFile }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

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
    const droppedFile = event.dataTransfer.files[0];
    if (droppedFile) onSelectFile(droppedFile);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) onSelectFile(selectedFile);
    event.target.value = "";
  };

  return (
    <div className={styles.container}>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleInputChange}
        accept=".gpkg"
        aria-label="Seleccionar archivo GeoPackage"
        className={styles.hiddenInput}
      />

      {isUploading ? (
        <div className={styles.progressArea}>
          <ProgressBar phase={UPLOAD_PHASE_LABEL} current={0} total={0} pct={uploadPct} />
        </div>
      ) : (
        <FileDropzone
          isDragOver={isDragOver}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          title="Arrastre y suelte su archivo GeoPackage (.gpkg) aquí"
          subtitle="o haga clic para seleccionar un archivo desde su equipo"
          formatBadges={FORMAT_BADGES}
        />
      )}

      {errorMessage && <AlertMessage type={AlertType.ERROR} text={errorMessage} />}
    </div>
  );
};
