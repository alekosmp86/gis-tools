"use client";

import React, { useRef, useState } from "react";
import { FileDropzone } from "@/ui-kit/components/FileDropzone";
import { FILE_NAME_FORMAT_HINT } from "../client";
import styles from "./IndicatorsFileDropzone.module.css";

interface IndicatorsFileDropzoneProps {
  onFilesChosen: (files: ReadonlyArray<File>) => void;
}

const CSV_ACCEPT = ".csv";

export const IndicatorsFileDropzone: React.FC<IndicatorsFileDropzoneProps> = ({ onFilesChosen }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(true);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    onFilesChosen(Array.from(event.dataTransfer.files));
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onFilesChosen(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  return (
    <>
      <FileDropzone
        isDragOver={isDragOver}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        title="Arrastre y suelte los archivos CSV aquí"
        subtitle="o haga clic para seleccionar uno o varios archivos desde su equipo"
        formatBadges={[FILE_NAME_FORMAT_HINT]}
      />
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={CSV_ACCEPT}
        className={styles.hiddenInput}
        onChange={handleInputChange}
        tabIndex={-1}
        aria-hidden="true"
      />
    </>
  );
};
