import { GeoPackageFormatError } from "@/core/binary/GeoPackageReader";
import {
  openGpkgFile,
  type OpenGpkgFile,
} from "@/core/services/server/gpkgReplace/gpkgRecordSource";
import {
  defaultFileReplaceDeps,
  defaultUploadDeps,
  handleFileStart,
  saveRequestUpload,
  type FileReplaceDeps,
  type FileUploadDeps,
} from "@/core/services/server/shpReplace/fileReplaceHandlers";
import { failureResponse, jsonResponse } from "@/core/services/server/shpReplace/replaceHttp";
import { GPKG_UPLOAD_PROFILE, UploadInvalidError } from "@/core/services/server/shpReplace/shpUploadStore";

export interface GpkgReplaceHandlerDeps extends FileReplaceDeps {
  openGpkg(filePath: string, layerName?: string): OpenGpkgFile;
}

export interface GpkgUploadHandlerDeps {
  uploads: FileUploadDeps;
  openGpkg(filePath: string, layerName?: string): OpenGpkgFile;
}

function defaultGpkgUploadDeps(): GpkgUploadHandlerDeps {
  return { uploads: defaultUploadDeps(GPKG_UPLOAD_PROFILE), openGpkg: openGpkgFile };
}

function defaultGpkgReplaceDeps(): GpkgReplaceHandlerDeps {
  return { ...defaultFileReplaceDeps(GPKG_UPLOAD_PROFILE), openGpkg: openGpkgFile };
}

function toInvalidUploadError(error: unknown): unknown {
  return error instanceof GeoPackageFormatError ? new UploadInvalidError(error.message) : error;
}

async function inspectUploadOrDiscard(deps: GpkgUploadHandlerDeps, uploadId: string): Promise<OpenGpkgFile> {
  try {
    return deps.openGpkg(await deps.uploads.locate(uploadId));
  } catch (error) {
    await deps.uploads.delete(uploadId).catch(() => undefined);
    throw toInvalidUploadError(error);
  }
}

export async function handleGpkgUpload(
  request: Request,
  deps: GpkgUploadHandlerDeps = defaultGpkgUploadDeps()
): Promise<Response> {
  try {
    const saved = await saveRequestUpload(request, deps.uploads);
    const gpkg = await inspectUploadOrDiscard(deps, saved.uploadId);
    return jsonResponse(200, {
      success: true,
      uploadId: saved.uploadId,
      size: saved.size,
      layers: gpkg.layers,
      fields: gpkg.fieldNames,
      srid: gpkg.srid,
    });
  } catch (error) {
    return failureResponse(error);
  }
}

export function handleGpkgStart(
  request: Request,
  deps: GpkgReplaceHandlerDeps = defaultGpkgReplaceDeps()
): Promise<Response> {
  return handleFileStart(request, deps, (filePath, start) => deps.openGpkg(filePath, start.layer));
}
