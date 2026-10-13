import type { ValidationResult } from "../../shared/requestReaders";
import { MAX_BODY_BYTES, MAX_FILE_BYTES, MAX_FILES_PER_RUN } from "../constants";
import { buildFileError, FileRejection, parseIndicatorsFile } from "../domain/csvIndicators";
import type { ParseOutcome } from "../types";

export const FILES_FIELD = "files";
export const CONFIRM_FIELD = "confirm";
export const ACCEPT_SHRINK_FIELD = "acceptShrink";
export const CONNECTION_FIELD = "connection";
const TRUE_VALUE = "true";

const NO_FILES_MESSAGE = "Seleccione al menos un archivo.";
const TOO_MANY_FILES_MESSAGE = `Se pueden procesar como máximo ${MAX_FILES_PER_RUN} archivos por vez.`;
const NOT_A_FILE_MESSAGE = "El campo de archivos solo admite archivos.";
const CONTENT_LENGTH_HEADER = "content-length";
const BODY_TOO_LARGE_MESSAGE = `La solicitud supera el tamaño máximo de ${MAX_BODY_BYTES} bytes.`;
const NOT_MULTIPART_MESSAGE = "La solicitud debe ser un formulario multipart válido.";

/** Message when the declared body size is over the limit; null when absent, invalid or within it. */
export function checkDeclaredBodySize(request: Request): string | null {
  const declared = request.headers.get(CONTENT_LENGTH_HEADER);
  if (declared === null || !/^\d+$/.test(declared.trim())) return null;
  return Number(declared) > MAX_BODY_BYTES ? BODY_TOO_LARGE_MESSAGE : null;
}

export async function readForm(request: Request): Promise<ValidationResult<FormData>> {
  try {
    return { ok: true, value: await request.formData() };
  } catch {
    return { ok: false, error: NOT_MULTIPART_MESSAGE };
  }
}

export function readFlag(form: FormData, fieldName: string): boolean {
  return form.get(fieldName) === TRUE_VALUE;
}

async function parseUpload(file: File): Promise<ParseOutcome> {
  if (file.size > MAX_FILE_BYTES) {
    return buildFileError(file.name, FileRejection.tooLarge(file.name, MAX_FILE_BYTES));
  }
  try {
    return parseIndicatorsFile(file.name, new Uint8Array(await file.arrayBuffer()));
  } catch {
    return buildFileError(file.name, FileRejection.unreadable(file.name));
  }
}

/** Reads and parses every file of the `files` field; per-file problems become file-level errors. */
export async function readUploads(form: FormData): Promise<ValidationResult<ParseOutcome[]>> {
  const entries = form.getAll(FILES_FIELD);
  if (entries.length === 0) return { ok: false, error: NO_FILES_MESSAGE };
  if (entries.length > MAX_FILES_PER_RUN) return { ok: false, error: TOO_MANY_FILES_MESSAGE };

  const files: File[] = [];
  for (const entry of entries) {
    if (typeof entry === "string") return { ok: false, error: NOT_A_FILE_MESSAGE };
    files.push(entry);
  }
  return { ok: true, value: await Promise.all(files.map(parseUpload)) };
}
