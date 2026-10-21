"use client";

import React, { useRef, useState } from "react";
import { FileDropzone } from "@/ui-kit/components/FileDropzone";
import { FILE_KINDS, FILE_NAME_FORMAT_HINTS } from "../client";
import styles from "./AvanceFileDropzone.module.css";

interface AvanceFileDropzoneProps {
  onFilesChosen: (files: ReadonlyArray<File>) => void;
}

const CSV_ACCEPT = ".csv";

export const AvanceFileDropzone: React.FC<AvanceFileDropzoneProps> = ({ onFilesChosen }) => {
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
        title="Arrastre y suelte las dos planillas CSV aquí"
        subtitle="o haga clic para seleccionar ambos archivos desde su equipo; cada uno se reconoce por su nombre"
        formatBadges={FILE_KINDS.map((kind) => FILE_NAME_FORMAT_HINTS[kind])}
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
