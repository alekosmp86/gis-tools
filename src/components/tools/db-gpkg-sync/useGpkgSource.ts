import { useState } from "react";
import { uploadGpkgFile, type GpkgUploadResult } from "@/core/services/gpkgReplaceClient";
import { reset as resetGpkgRun } from "@/core/services/gpkgReplaceRunStore";
import { parseSourceSrid } from "@/components/tools/db-shapefile-sync/useShpReplaceWorkflow";
import type { GpkgLayerInfo } from "@/core/types/gpkgReplace";

const GPKG_EXTENSION_PATTERN = /\.gpkg$/i;
const INVALID_FILE_MESSAGE = "Solo se admiten archivos .gpkg.";
const UPLOAD_ERROR_MESSAGE = "No se pudo subir el archivo GeoPackage.";
const NO_LAYERS: GpkgLayerInfo[] = [];
const NO_FIELDS: string[] = [];

const toPercent = (loaded: number, total: number): number => (total > 0 ? Math.round((loaded / total) * 100) : 0);

const firstLayerNameOf = (result: GpkgUploadResult): string | null => result.layers[0]?.name ?? null;

const describeUploadError = (error: unknown): string =>
  error instanceof Error && error.message.trim() !== "" ? error.message : UPLOAD_ERROR_MESSAGE;

type UploadOutcome = { result: GpkgUploadResult } | { error: string };

async function attemptUpload(file: File, onProgress: (loaded: number, total: number) => void): Promise<UploadOutcome> {
  try {
    return { result: await uploadGpkgFile(file, onProgress) };
  } catch (error: unknown) {
    return { error: describeUploadError(error) };
  }
}

export function useGpkgSource() {
  const [loadedFile, setLoadedFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<GpkgUploadResult | null>(null);
  const [selectedLayerName, setSelectedLayerName] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const discard = () => {
    resetGpkgRun();
    setLoadedFile(null);
    setUpload(null);
    setSelectedLayerName(null);
    setUploadPct(0);
    setErrorMessage(null);
  };

  const selectFile = async (candidate: File) => {
    discard();
    if (!GPKG_EXTENSION_PATTERN.test(candidate.name)) {
      setErrorMessage(INVALID_FILE_MESSAGE);
      return;
    }
    setIsUploading(true);
    const outcome = await attemptUpload(candidate, (loaded, total) => setUploadPct(toPercent(loaded, total))).finally(() =>
      setIsUploading(false)
    );
    if ("error" in outcome) {
      setErrorMessage(outcome.error);
      return;
    }
    setUpload(outcome.result);
    setSelectedLayerName(firstLayerNameOf(outcome.result));
    setLoadedFile(candidate);
  };

  const layers = upload?.layers ?? NO_LAYERS;
  const selectedLayer = layers.find((layer) => layer.name === selectedLayerName) ?? null;
  const hasMultipleLayers = layers.length > 1;

  return {
    file: loadedFile,
    uploadId: upload?.uploadId ?? null,
    layers,
    selectedLayer,
    selectLayer: setSelectedLayerName,
    hasMultipleLayers,
    layerParam: hasMultipleLayers ? selectedLayer?.name : undefined,
    fields: selectedLayer?.fieldNames ?? NO_FIELDS,
    recordCount: selectedLayer?.rowCount ?? 0,
    detectedSrid: selectedLayer?.srid != null ? parseSourceSrid(String(selectedLayer.srid)) : null,
    uploadPct,
    isUploading,
    errorMessage,
    selectFile,
    discard,
  };
}

export type GpkgSource = ReturnType<typeof useGpkgSource>;
