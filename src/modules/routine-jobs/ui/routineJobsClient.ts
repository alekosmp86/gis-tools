import type { ResolvedColumn, TableListing } from "@/core/types/tableCatalog";
import type { TableRole } from "../jobs/cargar-padrones/constants";
import type { ClientConnection, JobStatusView, StartRequest } from "./clientTypes";

const BASE_ROUTE = "/api/m/routine-jobs";
const CATALOG_TABLES_ROUTE = `${BASE_ROUTE}/catalog/tables`;
const CATALOG_COLUMNS_ROUTE = `${BASE_ROUTE}/catalog/columns`;
const START_ROUTE = `${BASE_ROUTE}/cargar-padrones/start`;
const STATUS_ROUTE = `${BASE_ROUTE}/cargar-padrones/status`;
const JSON_HEADERS = { "Content-Type": "application/json" };
const NETWORK_MESSAGE = "No se pudo conectar con el servidor.";
const INVALID_RESPONSE_MESSAGE = "El servidor devolvió una respuesta no válida.";
const FAILED_REQUEST_MESSAGE = "No se pudo completar la operación en el servidor.";
const NO_RESPONSE_STATUS = 0;
export const STATUS_TIMEOUT_MS = 15000;
const STATUS_TIMEOUT_MESSAGE = "La consulta del estado tardó demasiado tiempo. Revise la conexión con el servidor.";

type JsonRecord = Record<string, unknown>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

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
  listColumns(
    connection: ClientConnection,
    schema: string,
    table: string,
    role: TableRole,
  ): Promise<ResolvedColumn[]>;
  start(request: StartRequest): Promise<StartResult>;
  readStatus(jobId: string): Promise<JobStatusView>;
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

export function createRoutineJobsClient(deps: RoutineJobsClientDeps = {}): RoutineJobsClient {
  const fetchImpl = deps.fetch ?? defaultFetch;
  const setTimer = deps.setTimer ?? defaultSetTimer;
  const clearTimer = deps.clearTimer ?? defaultClearTimer;

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

    async start(request) {
      const payload = await postJson(fetchImpl, START_ROUTE, request);
      if (typeof payload.jobId !== "string") throw invalidResponse();
      return { jobId: payload.jobId };
    },

    async readStatus(jobId) {
      const url = `${STATUS_ROUTE}?jobId=${encodeURIComponent(jobId)}`;
      const controller = new AbortController();
      let timedOut = false;
      const handle = setTimer(() => {
        timedOut = true;
        controller.abort();
      }, STATUS_TIMEOUT_MS);
      try {
        const payload = await readPayload(await send(fetchImpl, url, { signal: controller.signal }));
        if (!isRecord(payload.job)) throw invalidResponse();
        return payload.job as unknown as JobStatusView;
      } catch (error: unknown) {
        if (timedOut) throw new RoutineJobsApiError(STATUS_TIMEOUT_MESSAGE, NO_RESPONSE_STATUS);
        throw error;
      } finally {
        clearTimer(handle);
      }
    },
  };
}
