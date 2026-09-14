import { useRef, useState } from "react";
import type { ParsedFileDataset } from "@/core/types/parsers";
import { ShapefileParser } from "@/core/services/parsers/ShapefileParser";
import { CsvParser } from "@/core/services/parsers/CsvParser";

export interface UseFileUploaderProps {
  onFileParsed: (dataset: ParsedFileDataset | null) => void;
}

export function useFileUploader({ onFileParsed }: UseFileUploaderProps) {
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
      setErrorMessage(
        "Formato de archivo no soportado. Por favor suba un archivo .zip (Shapefile), .geojson o .csv."
      );
      return;
    }

    parser
      .parse(file)
      .then((dataset) => {
        onFileParsed(dataset);
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Error al procesar el archivo espacial.";
        setErrorMessage(message);
        onFileParsed(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      processFile(selectedFile);
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
    const droppedFile = event.dataTransfer.files?.[0];
    if (droppedFile) {
      processFile(droppedFile);
    }
  };

  const handleClear = () => {
    onFileParsed(null);
    setErrorMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  return {
    fileInputRef,
    isDragging,
    isLoading,
    errorMessage,
    handleFileSelect,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleClear,
    openFileDialog,
  };
}
