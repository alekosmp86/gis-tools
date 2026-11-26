import { openCsvFile } from "@/core/services/server/csvReplace/csvRecordSource";
import type { ReplaceRecordSource } from "@/core/services/server/shpReplace/replaceRecordSource";
import {
  defaultFileReplaceDeps,
  defaultUploadDeps,
  handleFileStart,
  handleFileUpload,
  type FileReplaceDeps,
  type FileUploadDeps,
} from "@/core/services/server/shpReplace/fileReplaceHandlers";
import { CSV_UPLOAD_PROFILE } from "@/core/services/server/shpReplace/shpUploadStore";

export type CsvUploadDeps = FileUploadDeps;

export interface CsvReplaceHandlerDeps extends FileReplaceDeps {
  openCsv(filePath: string): ReplaceRecordSource;
}

function defaultCsvReplaceDeps(): CsvReplaceHandlerDeps {
  return { ...defaultFileReplaceDeps(CSV_UPLOAD_PROFILE), openCsv: openCsvFile };
}

export function handleCsvUpload(
  request: Request,
  deps: { uploads: CsvUploadDeps } = { uploads: defaultUploadDeps(CSV_UPLOAD_PROFILE) }
): Promise<Response> {
  return handleFileUpload(request, deps.uploads);
}

export function handleCsvStart(
  request: Request,
  deps: CsvReplaceHandlerDeps = defaultCsvReplaceDeps()
): Promise<Response> {
  return handleFileStart(request, deps, (filePath) => deps.openCsv(filePath));
}
