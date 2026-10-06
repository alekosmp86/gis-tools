import React, { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ISpatialFileParser, ParsedFileDataset, FileParseProgress } from "@/core/types/parsers";

export interface UseSpatialFileUploadOptions {
  createParser: () => ISpatialFileParser;
  fallbackErrorMessage: string;
  loadedData: ParsedFileDataset | null;
  onSuccess: (data: ParsedFileDataset) => void;
  onDiscard: () => void;
}

export interface SpatialFileUpload {
  data: ParsedFileDataset | null;
  loading: boolean;
  progress: FileParseProgress | null;
  errorMessage: string | null;
  isDragOver: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  processFile: (file: File) => Promise<void>;
  handleFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleDragOver: (event: React.DragEvent) => void;
  handleDragLeave: (event: React.DragEvent) => void;
  handleDrop: (event: React.DragEvent) => void;
  handleDropzoneKeyDown: (event: React.KeyboardEvent) => void;
  handleDiscard: () => void;
}

export const useSpatialFileUpload = ({
  createParser,
  fallbackErrorMessage,
  loadedData,
  onSuccess,
  onDiscard,
}: UseSpatialFileUploadOptions): SpatialFileUpload => {
  const queryClient = useQueryClient();
  const [data, setData] = useState<ParsedFileDataset | null>(loadedData);
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
      const parser = createParser();
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
      onSuccess(parsed);
      setLoading(false);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : fallbackErrorMessage;
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
    setProgress(null);
    setErrorMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    onDiscard();
  };

  return {
    data,
    loading,
    progress,
    errorMessage,
    isDragOver,
    fileInputRef,
    processFile,
    handleFileChange,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDropzoneKeyDown,
    handleDiscard,
  };
};
