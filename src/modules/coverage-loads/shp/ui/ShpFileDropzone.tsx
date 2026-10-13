"use client";

import React, { useRef, useState } from "react";
import { FileDropzone } from "@/ui-kit/components/FileDropzone";
import { SHP_ACCEPT } from "./shpUiConstants";
import styles from "./ShpFileDropzone.module.css";

interface ShpFileDropzoneProps {
  onFileChosen: (file: File) => void;
}

const NAME_FORMAT_BADGES = ["NRUruguay_aaaammdd.shp", "WCDMAUruguay_aaaammdd.shp", "NBIoTUruguay_aaaammdd.shp", "LTEUruguay_aaaammdd.shp"];

export const ShpFileDropzone: React.FC<ShpFileDropzoneProps> = ({ onFileChosen }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(true);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);
    const [file] = Array.from(event.dataTransfer.files);
    if (file) onFileChosen(file);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? []);
    if (file) onFileChosen(file);
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
        title="Arrastre y suelte el archivo SHP aquí"
        subtitle="o haga clic para seleccionarlo desde su equipo"
        formatBadges={NAME_FORMAT_BADGES}
      />
      <input
        ref={inputRef}
        type="file"
        accept={SHP_ACCEPT}
        className={styles.hiddenInput}
        onChange={handleInputChange}
        tabIndex={-1}
        aria-hidden="true"
      />
    </>
  );
};
