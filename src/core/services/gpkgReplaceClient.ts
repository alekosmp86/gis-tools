import { uploadReplaceFile, type ShpUploadProgress, type ShpUploadResult } from "@/core/services/shpReplaceClient";
import type { GpkgLayerInfo } from "@/core/types/gpkgReplace";

export const GPKG_START_ROUTE = "/api/db/gpkg-replace/start";
export const GPKG_STATUS_ROUTE = "/api/db/gpkg-replace/status";

const GPKG_UPLOAD_ROUTE = "/api/db/gpkg-replace/upload";

export interface GpkgUploadResult extends ShpUploadResult {
  layers: GpkgLayerInfo[];
}

export const GPKG_UPLOAD_TARGET = { route: GPKG_UPLOAD_ROUTE, fileName: "datos.gpkg" };

export const uploadGpkgFile = (file: File, onProgress?: ShpUploadProgress): Promise<GpkgUploadResult> =>
  uploadReplaceFile<GpkgUploadResult>({ route: GPKG_UPLOAD_ROUTE, fileName: file.name }, file, onProgress);
