import type { ValidationResult } from "../../shared/requestReaders";
import { MAX_FILE_BYTES } from "../../constants";
import { MAX_FILES_PER_RUN } from "../constants";
import { buildFileError, FileRejection, parseAvanceFile } from "../domain/csvAvance";
import type { ParseOutcome } from "../types";

const FILES_FIELD = "files";
export const CONFIRM_FIELD = "confirm";
export const DRY_RUN_FIELD = "dryRun";
export const CONNECTION_FIELD = "connection";

const WRONG_FILE_COUNT_MESSAGE = `Hay que subir exactamente ${MAX_FILES_PER_RUN} archivos: uno de Interior y uno de Montevideo (UDPEM).`;
const NOT_A_FILE_MESSAGE = "El campo de archivos solo admite archivos.";

async function parseUpload(file: File): Promise<ParseOutcome> {
  if (file.size > MAX_FILE_BYTES) {
    return buildFileError(file.name, FileRejection.tooLarge(file.name, MAX_FILE_BYTES));
  }
  try {
    return parseAvanceFile(file.name, new Uint8Array(await file.arrayBuffer()));
  } catch {
    return buildFileError(file.name, FileRejection.unreadable(file.name));
  }
}

/** Reads and parses the two files of the `files` field; per-file problems become file-level errors. */
export async function readUploads(form: FormData): Promise<ValidationResult<ParseOutcome[]>> {
  const entries = form.getAll(FILES_FIELD);
  if (entries.length !== MAX_FILES_PER_RUN) return { ok: false, error: WRONG_FILE_COUNT_MESSAGE };

  const files: File[] = [];
  for (const entry of entries) {
    if (typeof entry === "string") return { ok: false, error: NOT_A_FILE_MESSAGE };
    files.push(entry);
  }
  return { ok: true, value: await Promise.all(files.map(parseUpload)) };
}
