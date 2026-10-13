import { HEADER_FILE_NAME, HEADER_FILE_SIZE, UPLOAD_CONTENT_TYPE } from "../constants";
import type { JobTarget } from "../job/types.ts";
import type { ShpJobRef } from "../domain/shpFlowState";
import { API_BASE, ShpRequestError, toNetworkError } from "./shpHttp";

const UPLOAD_FAILURE = "No se pudo subir el archivo";
const PERCENT = 100;
const HTTP_OK = 200;
const HTTP_MULTIPLE_CHOICES = 300;

/** The upload was cancelled by the user: not a failure worth showing. */
export class ShpUploadAborted extends Error {
  constructor() {
    super("Subida cancelada.");
    this.name = "ShpUploadAborted";
  }
}

interface UploadPayload {
  readonly jobId: string;
  readonly target: JobTarget;
  readonly sizeBytes: number;
  readonly error?: string;
}

function readPayload(xhr: XMLHttpRequest): Partial<UploadPayload> {
  try {
    return JSON.parse(xhr.responseText) as Partial<UploadPayload>;
  } catch {
    return {};
  }
}

function toJobRef(file: File, payload: Partial<UploadPayload>): ShpJobRef | null {
  if (payload.jobId === undefined || payload.target === undefined) return null;
  return { jobId: payload.jobId, target: payload.target, fileName: file.name, sizeBytes: payload.sizeBytes ?? file.size };
}

function settle(xhr: XMLHttpRequest, file: File): ShpJobRef {
  const payload = readPayload(xhr);
  const job = xhr.status >= HTTP_OK && xhr.status < HTTP_MULTIPLE_CHOICES ? toJobRef(file, payload) : null;
  if (job === null) throw new ShpRequestError(payload.error ?? `${UPLOAD_FAILURE} (HTTP ${xhr.status}).`);
  return job;
}

/**
 * Streams the .shp as the raw request body (never FormData) so the server can write it to disk
 * without buffering. XMLHttpRequest is used because fetch exposes no upload byte progress.
 */
export function uploadShp(file: File, onPercent: (percent: number) => void, signal: AbortSignal): Promise<ShpJobRef> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ShpUploadAborted());
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/upload`);
    xhr.setRequestHeader("Content-Type", UPLOAD_CONTENT_TYPE);
    xhr.setRequestHeader(HEADER_FILE_NAME, encodeURIComponent(file.name));
    xhr.setRequestHeader(HEADER_FILE_SIZE, String(file.size));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onPercent(Math.floor((event.loaded / event.total) * PERCENT));
    };
    xhr.onload = () => {
      try {
        resolve(settle(xhr, file));
      } catch (failure: unknown) {
        reject(failure);
      }
    };
    xhr.onerror = () => reject(toNetworkError(null));
    xhr.onabort = () => reject(new ShpUploadAborted());
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
