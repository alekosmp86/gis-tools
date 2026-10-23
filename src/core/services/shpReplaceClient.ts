import type { ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import type { ShpJobSnapshot } from "@/core/services/server/shpReplace/shpReplaceJobStore";
import type { GeometryProcessingOptions } from "@/core/types/geometryProcessing";

export const SHP_UPLOAD_FILE_NAME = "shapefile.zip";

const SHP_UPLOAD_ROUTE = "/api/db/shp-replace/upload";
const SHP_START_ROUTE = "/api/db/shp-replace/start";
const SHP_STATUS_ROUTE = "/api/db/shp-replace/status";
const FILE_NAME_HEADER = "x-file-name";
const JSON_HEADERS = { "Content-Type": "application/json" };

const UPLOAD_FALLBACK_MESSAGE = "No se pudo subir el archivo.";
const UPLOAD_NETWORK_MESSAGE = "No se pudo conectar con el servidor para subir el archivo.";
const UPLOAD_ABORTED_MESSAGE = "La subida del archivo fue cancelada.";
const START_FALLBACK_MESSAGE = "No se pudo iniciar el reemplazo completo.";
const STATUS_FALLBACK_MESSAGE = "No se pudo consultar el estado del reemplazo.";
const NETWORK_MESSAGE = "No se pudo contactar con el servidor.";

type JsonRecord = Record<string, unknown>;
export type ShpUploadProgress = (loaded: number, total: number) => void;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ShpUploadResult {
  uploadId: string;
  size: number;
}

export interface ShpStartBody {
  host: string;
  port: string;
  db_name: string;
  user: string;
  password: string;
  schema_name: string;
  table_name: string;
  uploadId: string;
  mapping: ReplaceColumnMapping;
  sourceSrid: number;
  resetSequences: boolean;
  geometryProcessing: GeometryProcessingOptions;
  dryRun: boolean;
  confirm: true;
}

export interface ShpStartResult {
  jobId: string;
}

export interface ShpUploadDeps {
  createXhr?: () => XMLHttpRequest;
}

export interface ShpFetchDeps {
  fetchImpl?: FetchLike;
}

const defaultFetch: FetchLike = (input, init) => fetch(input, init);
const createDefaultXhr = (): XMLHttpRequest => new XMLHttpRequest();

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseJsonRecord(text: string): JsonRecord | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function describeServerError(payload: JsonRecord | null, status: number, fallback: string): string {
  const serverMessage = payload?.error;
  return typeof serverMessage === "string" && serverMessage.trim() !== ""
    ? serverMessage
    : `${fallback} (código HTTP ${status}).`;
}

function readUploadResult(xhr: XMLHttpRequest): ShpUploadResult {
  const payload = parseJsonRecord(xhr.responseText);
  const isSuccess =
    xhr.status >= 200 &&
    xhr.status < 300 &&
    payload?.success === true &&
    typeof payload.uploadId === "string" &&
    typeof payload.size === "number";
  if (!isSuccess || !payload) {
    throw new Error(describeServerError(payload, xhr.status, UPLOAD_FALLBACK_MESSAGE));
  }
  return { uploadId: String(payload.uploadId), size: Number(payload.size) };
}

export function uploadShapefileZip(
  file: Blob,
  onProgress?: ShpUploadProgress,
  deps: ShpUploadDeps = {}
): Promise<ShpUploadResult> {
  return new Promise<ShpUploadResult>((resolve, reject) => {
    const xhr = (deps.createXhr ?? createDefaultXhr)();
    xhr.open("POST", SHP_UPLOAD_ROUTE);
    xhr.setRequestHeader(FILE_NAME_HEADER, SHP_UPLOAD_FILE_NAME);
    xhr.upload.onprogress = (event: ProgressEvent) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    xhr.onload = () => {
      try {
        resolve(readUploadResult(xhr));
      } catch (uploadError) {
        reject(uploadError);
      }
    };
    xhr.onerror = () => reject(new Error(UPLOAD_NETWORK_MESSAGE));
    xhr.onabort = () => reject(new Error(UPLOAD_ABORTED_MESSAGE));
    xhr.send(file);
  });
}

async function sendRequest(fetchImpl: FetchLike, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch {
    throw new Error(NETWORK_MESSAGE);
  }
}

async function readJsonOrThrow(response: Response, fallback: string): Promise<JsonRecord> {
  const payload = parseJsonRecord(await response.text());
  if (!response.ok || !payload) throw new Error(describeServerError(payload, response.status, fallback));
  return payload;
}

export async function startShpReplace(body: ShpStartBody, deps: ShpFetchDeps = {}): Promise<ShpStartResult> {
  const response = await sendRequest(deps.fetchImpl ?? defaultFetch, SHP_START_ROUTE, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  const payload = await readJsonOrThrow(response, START_FALLBACK_MESSAGE);
  if (typeof payload.jobId !== "string") throw new Error(START_FALLBACK_MESSAGE);
  return { jobId: payload.jobId };
}

export async function fetchShpReplaceStatus(jobId: string, deps: ShpFetchDeps = {}): Promise<ShpJobSnapshot> {
  const url = `${SHP_STATUS_ROUTE}?jobId=${encodeURIComponent(jobId)}`;
  const response = await sendRequest(deps.fetchImpl ?? defaultFetch, url);
  const payload = await readJsonOrThrow(response, STATUS_FALLBACK_MESSAGE);
  return (isRecord(payload.job) ? payload.job : payload) as unknown as ShpJobSnapshot;
}
