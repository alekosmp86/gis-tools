import { BYTES_PER_GIB, HEADER_FILE_NAME, HEADER_FILE_SIZE, UPLOAD_CONTENT_TYPE } from "../constants";
import { UPLOAD_CAP_BYTES } from "../job/constants.ts";
import { parseShpFileName } from "../job/fileName.ts";
import type { JobTarget } from "../job/types.ts";

const WRONG_CONTENT_TYPE = `El contenido debe enviarse como ${UPLOAD_CONTENT_TYPE}.`;
const MISSING_NAME = `Falta el encabezado ${HEADER_FILE_NAME} con el nombre del archivo.`;
const BAD_SIZE = `El encabezado ${HEADER_FILE_SIZE} debe ser un entero positivo (bytes).`;
const TOO_LARGE = `El archivo supera el tamaño máximo de ${UPLOAD_CAP_BYTES / BYTES_PER_GIB} GiB.`;
const NO_BODY = "La solicitud no contiene el archivo.";
const DIGITS = /^\d+$/;

export interface UploadHeaders {
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly target: JobTarget;
}

export type UploadHeadersResult =
  | { readonly ok: true; readonly value: UploadHeaders }
  | { readonly ok: false; readonly error: string; readonly tooLarge: boolean };

function bad(error: string, tooLarge = false): UploadHeadersResult {
  return { ok: false, error, tooLarge };
}

function readFileName(request: Request): string | null {
  const raw = request.headers.get(HEADER_FILE_NAME);
  if (raw === null || raw.length === 0) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** Everything that can be refused before a byte of the body is read. */
export function readUploadHeaders(request: Request): UploadHeadersResult {
  if (!(request.headers.get("content-type") ?? "").startsWith(UPLOAD_CONTENT_TYPE)) return bad(WRONG_CONTENT_TYPE);
  if (request.body === null) return bad(NO_BODY);

  const fileName = readFileName(request);
  if (fileName === null) return bad(MISSING_NAME);
  const parsed = parseShpFileName(fileName);
  if (!parsed.ok) return bad(parsed.message);

  const rawSize = (request.headers.get(HEADER_FILE_SIZE) ?? "").trim();
  if (!DIGITS.test(rawSize)) return bad(BAD_SIZE);
  const sizeBytes = Number(rawSize);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) return bad(BAD_SIZE);
  if (sizeBytes > UPLOAD_CAP_BYTES) return bad(TOO_LARGE, true);

  const target: JobTarget = { table: parsed.table, prefix: parsed.prefix, fechaact: parsed.fechaact };
  return { ok: true, value: { fileName, sizeBytes, target } };
}
