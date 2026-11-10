import { GeometryOptionsInvalidError } from "@/core/services/geometryProcessingOptions";
import type { ShpJobStore } from "@/core/services/server/shpReplace/shpReplaceJobStore";
import { ShpRequestInvalidError, type ShpStartRequest } from "@/core/services/server/shpReplace/shpReplaceRequest";
import {
  UploadInvalidError,
  UploadNotFoundError,
  UploadTooLargeError,
} from "@/core/services/server/shpReplace/shpUploadStore";

export const FILE_NAME_HEADER = "x-file-name";
export const CONFLICT_MESSAGE = "Ya hay un reemplazo en curso para esta tabla.";

const HOUR_MS = 60 * 60 * 1000;
const UPLOAD_MAX_AGE_MS = 2 * HOUR_MS;
const JOB_MAX_AGE_MS = HOUR_MS;
const REDACTION = "***";
const INTERNAL_ERROR_MESSAGE = "Error interno al procesar la solicitud.";
const UNKNOWN_ERROR_MESSAGE = "Error desconocido.";

export interface SweepableUploads {
  sweep?(maxAgeMs: number): Promise<number>;
}

export const jsonResponse = (status: number, body: object): Response => Response.json(body, { status });

export const errorResponse = (status: number, message: string): Response =>
  jsonResponse(status, { success: false, error: message });

export const errorTextOf = (error: unknown): string => (error instanceof Error ? error.message : UNKNOWN_ERROR_MESSAGE);

export const scrubSecret = (text: string, secret: string): string => text.split(secret).join(REDACTION);

function statusOf(error: unknown): number {
  if (error instanceof UploadTooLargeError) return 413;
  if (error instanceof UploadNotFoundError) return 404;
  if (error instanceof UploadInvalidError || error instanceof ShpRequestInvalidError) return 400;
  if (error instanceof GeometryOptionsInvalidError) return 400;
  return 500;
}

export function failureResponse(error: unknown): Response {
  const status = statusOf(error);
  return errorResponse(status, status === 500 ? INTERNAL_ERROR_MESSAGE : errorTextOf(error));
}

export async function sweepUploadsStale(uploads: SweepableUploads): Promise<void> {
  await uploads.sweep?.(UPLOAD_MAX_AGE_MS).catch(() => 0);
}

export function sweepJobsStale(store: ShpJobStore): void {
  store.sweep(JOB_MAX_AGE_MS);
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ShpRequestInvalidError("El cuerpo de la petición no es JSON válido.");
  }
}

export const tableKeyOf = (start: ShpStartRequest): string =>
  `${start.connection.host}:${start.connection.port}|${start.connection.db_name}|${start.target.schema_name}|${start.target.table_name}`;
