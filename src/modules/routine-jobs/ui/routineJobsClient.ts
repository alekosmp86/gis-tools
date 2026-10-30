import type { ResolvedColumn, TableListing } from "@/core/types/tableCatalog";
import type { TableRole } from "../jobs/cargar-padrones/constants";
import type { ActualizarTableRole } from "../jobs/actualizar-padron/constants";
import type { LocalidadesTableRole } from "../jobs/cargar-localidades/constants";
import type { UnitTableRole } from "../jobs/unidad-territorial/constants";
import type { CompletarTableRole } from "../jobs/completar-unidad-territorial/constants";
import type {
  ActualizarJobStatusView,
  ActualizarStartRequest,
  ClientConnection,
  CompletarJobStatusView,
  CompletarStartRequest,
  JobStatusView,
  LocalidadesJobStatusView,
  LocalidadesStartRequest,
  StartRequest,
  UnidadJobStatusView,
  UnidadStartRequest,
} from "./clientTypes";

const BASE_ROUTE = "/api/m/routine-jobs";
const CATALOG_TABLES_ROUTE = `${BASE_ROUTE}/catalog/tables`;
const CATALOG_COLUMNS_ROUTE = `${BASE_ROUTE}/catalog/columns`;
const START_ROUTE = `${BASE_ROUTE}/cargar-padrones/start`;
const STATUS_ROUTE = `${BASE_ROUTE}/cargar-padrones/status`;
const ACTUALIZAR_START_ROUTE = `${BASE_ROUTE}/actualizar-padron/start`;
const ACTUALIZAR_STATUS_ROUTE = `${BASE_ROUTE}/actualizar-padron/status`;
const LOCALIDADES_START_ROUTE = `${BASE_ROUTE}/cargar-localidades/start`;
const LOCALIDADES_STATUS_ROUTE = `${BASE_ROUTE}/cargar-localidades/status`;
const UNIDAD_START_ROUTE = `${BASE_ROUTE}/unidad-territorial/start`;
const UNIDAD_STATUS_ROUTE = `${BASE_ROUTE}/unidad-territorial/status`;
const COMPLETAR_START_ROUTE = `${BASE_ROUTE}/completar-unidad-territorial/start`;
const COMPLETAR_STATUS_ROUTE = `${BASE_ROUTE}/completar-unidad-territorial/status`;
const ACTUALIZAR_BACKUP_ROUTE = `${BASE_ROUTE}/actualizar-padron/backup`;
const JSON_HEADERS = { "Content-Type": "application/json" };
const NETWORK_MESSAGE = "No se pudo conectar con el servidor.";
const INVALID_RESPONSE_MESSAGE = "El servidor devolvió una respuesta no válida.";
const FAILED_REQUEST_MESSAGE = "No se pudo completar la operación en el servidor.";
const NO_RESPONSE_STATUS = 0;
export const STATUS_TIMEOUT_MS = 15000;
const STATUS_TIMEOUT_MESSAGE = "La consulta del estado tardó demasiado tiempo. Revise la conexión con el servidor.";

type JsonRecord = Record<string, unknown>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ColumnRole = TableRole | ActualizarTableRole | LocalidadesTableRole | UnitTableRole | CompletarTableRole;

export interface RoutineJobsClientDeps {
  fetch?: FetchLike;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface StartResult {
  jobId: string;
}

export interface RoutineJobsClient {
  listTables(connection: ClientConnection, schema: string): Promise<TableListing>;
  listColumns(connection: ClientConnection, schema: string, table: string, role: ColumnRole): Promise<ResolvedColumn[]>;
  start(request: StartRequest): Promise<StartResult>;
  readStatus(jobId: string): Promise<JobStatusView>;
  startActualizar(request: ActualizarStartRequest): Promise<StartResult>;
  readActualizarStatus(jobId: string): Promise<ActualizarJobStatusView>;
  startLocalidades(request: LocalidadesStartRequest): Promise<StartResult>;
  readLocalidadesStatus(jobId: string): Promise<LocalidadesJobStatusView>;
  startUnidad(request: UnidadStartRequest): Promise<StartResult>;
  readUnidadStatus(jobId: string): Promise<UnidadJobStatusView>;
  startCompletar(request: CompletarStartRequest): Promise<StartResult>;
  readCompletarStatus(jobId: string): Promise<CompletarJobStatusView>;
  fetchActualizarBackup(token: string): Promise<Blob>;
}

export class RoutineJobsApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RoutineJobsApiError";
    this.status = status;
  }
}

const defaultFetch: FetchLike = (input, init) => fetch(input, init);
const defaultSetTimer = (callback: () => void, ms: number): unknown => setTimeout(callback, ms);
const defaultClearTimer = (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>);

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

function failureMessageOf(payload: JsonRecord | null, status: number): string {
  const serverMessage = payload?.error;
  if (typeof serverMessage === "string" && serverMessage.trim() !== "") return serverMessage;
  return `${FAILED_REQUEST_MESSAGE} (código ${status}).`;
}

async function send(fetchImpl: FetchLike, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch {
    throw new RoutineJobsApiError(NETWORK_MESSAGE, NO_RESPONSE_STATUS);
  }
}

async function readPayload(response: Response): Promise<JsonRecord> {
  const text = await response.text().catch(() => "");
  const payload = parseJsonRecord(text);
  if (!payload) {
    throw new RoutineJobsApiError(INVALID_RESPONSE_MESSAGE, response.ok ? NO_RESPONSE_STATUS : response.status);
  }
  if (!response.ok || payload.success !== true) {
    throw new RoutineJobsApiError(failureMessageOf(payload, response.status), response.status);
  }
  return payload;
}

async function postJson(fetchImpl: FetchLike, url: string, body: unknown): Promise<JsonRecord> {
  const response = await send(fetchImpl, url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  return readPayload(response);
}

function invalidResponse(): RoutineJobsApiError {
  return new RoutineJobsApiError(INVALID_RESPONSE_MESSAGE, NO_RESPONSE_STATUS);
}

async function readBackupBlob(response: Response): Promise<Blob> {
  if (!response.ok) {
    const payload = parseJsonRecord(await response.text().catch(() => ""));
    throw new RoutineJobsApiError(failureMessageOf(payload, response.status), response.status);
  }
  try {
    return await response.blob();
  } catch {
    throw new RoutineJobsApiError(NETWORK_MESSAGE, NO_RESPONSE_STATUS);
  }
}

async function postStart(fetchImpl: FetchLike, route: string, request: unknown): Promise<StartResult> {
  const payload = await postJson(fetchImpl, route, request);
  if (typeof payload.jobId !== "string") throw invalidResponse();
  return { jobId: payload.jobId };
}

interface TimerDeps {
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

/** Reads one job status with a short timeout; the timer aborts the request and is always cleared. */
async function readJobStatus<Job>(fetchImpl: FetchLike, timers: TimerDeps, route: string, jobId: string): Promise<Job> {
  const url = `${route}?jobId=${encodeURIComponent(jobId)}`;
  const controller = new AbortController();
  let timedOut = false;
  const handle = timers.setTimer(() => {
    timedOut = true;
    controller.abort();
  }, STATUS_TIMEOUT_MS);
  try {
    const payload = await readPayload(await send(fetchImpl, url, { signal: controller.signal }));
    if (!isRecord(payload.job)) throw invalidResponse();
    return payload.job as unknown as Job;
  } catch (error: unknown) {
    if (timedOut) throw new RoutineJobsApiError(STATUS_TIMEOUT_MESSAGE, NO_RESPONSE_STATUS);
    throw error;
  } finally {
    timers.clearTimer(handle);
  }
}

export function createRoutineJobsClient(deps: RoutineJobsClientDeps = {}): RoutineJobsClient {
  const fetchImpl = deps.fetch ?? defaultFetch;
  const timers: TimerDeps = {
    setTimer: deps.setTimer ?? defaultSetTimer,
    clearTimer: deps.clearTimer ?? defaultClearTimer,
  };

  return {
    async listTables(connection, schema) {
      const payload = await postJson(fetchImpl, CATALOG_TABLES_ROUTE, { connection, schema });
      if (typeof payload.schemaExists !== "boolean" || !Array.isArray(payload.tables)) throw invalidResponse();
      return { schemaExists: payload.schemaExists, tables: payload.tables as TableListing["tables"] };
    },

    async listColumns(connection, schema, table, role) {
      const payload = await postJson(fetchImpl, CATALOG_COLUMNS_ROUTE, { connection, schema, table, role });
      if (!Array.isArray(payload.columns)) throw invalidResponse();
      return payload.columns as ResolvedColumn[];
    },

    start: (request) => postStart(fetchImpl, START_ROUTE, request),

    readStatus: (jobId) => readJobStatus<JobStatusView>(fetchImpl, timers, STATUS_ROUTE, jobId),

    startActualizar: (request) => postStart(fetchImpl, ACTUALIZAR_START_ROUTE, request),

    readActualizarStatus: (jobId) =>
      readJobStatus<ActualizarJobStatusView>(fetchImpl, timers, ACTUALIZAR_STATUS_ROUTE, jobId),

    startLocalidades: (request) => postStart(fetchImpl, LOCALIDADES_START_ROUTE, request),

    readLocalidadesStatus: (jobId) =>
      readJobStatus<LocalidadesJobStatusView>(fetchImpl, timers, LOCALIDADES_STATUS_ROUTE, jobId),

    startUnidad: (request) => postStart(fetchImpl, UNIDAD_START_ROUTE, request),

    readUnidadStatus: (jobId) => readJobStatus<UnidadJobStatusView>(fetchImpl, timers, UNIDAD_STATUS_ROUTE, jobId),

    startCompletar: (request) => postStart(fetchImpl, COMPLETAR_START_ROUTE, request),

    readCompletarStatus: (jobId) =>
      readJobStatus<CompletarJobStatusView>(fetchImpl, timers, COMPLETAR_STATUS_ROUTE, jobId),

    async fetchActualizarBackup(token) {
      const url = `${ACTUALIZAR_BACKUP_ROUTE}?token=${encodeURIComponent(token)}`;
      return readBackupBlob(await send(fetchImpl, url));
    },
  };
}
